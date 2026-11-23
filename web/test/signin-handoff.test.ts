// One-tap sign-in between SiteVault and AdVault (2026-11-20, src/signin.ts):
// GET /auth/handoff (from AdVault) and GET /go/advault (to AdVault), through
// the whole fetch handler with in-memory KV, like embed.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { accountForAdvault, createAccount, startSession, type Account } from "../src/accounts.js";
import { signCreateHandoff, signHandoff } from "../src/embed.js";
import { mintSigninToken, safeLocalPath, signSigninToken, verifySigninToken, type SigninToken } from "../src/signin.js";

function memoryKv() {
  const data = new Map<string, { value: string; metadata?: unknown }>();
  return {
    data,
    async get(key: string, type?: string) {
      const e = data.get(key);
      if (!e) return null;
      return type === "json" ? JSON.parse(e.value) : e.value;
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      data.set(key, { value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true, cursor: undefined };
    },
  };
}

let kv: ReturnType<typeof memoryKv>;
let env: Record<string, unknown>;
let pending: Promise<unknown>[];
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }) as unknown as ExecutionContext;

const ORIGIN = "https://sitevault.test";
const TOKEN = "internal-token";
const ADV_ID = "11111111-2222-3333-4444-555555555555";
const TEST_ID = "22222222-2222-3333-4444-555555555555";
const ADMIN_ID = "33333333-2222-3333-4444-555555555555";
const EMAIL = "owner@example.com";
const ADMIN_EMAIL = "boss@example.com";
const KVNS = () => kv as unknown as KVNamespace;

beforeEach(() => {
  kv = memoryKv();
  pending = [];
  env = { SITES: kv, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: TOKEN, ADMIN_EMAILS: ADMIN_EMAIL };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

const handoffUrl = (t: string, to?: string) => `${ORIGIN}/auth/handoff?t=${encodeURIComponent(t)}${to === undefined ? "" : `&to=${encodeURIComponent(to)}`}`;
const fromAdvault = (uid: string, email: string, nowMs = Date.now()) => mintSigninToken(TOKEN, "signin-sitevault", { uid, email }, nowMs);
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

async function sessionAccountId(res: Response): Promise<string | null> {
  const me = await call(`${ORIGIN}/account`, { headers: { cookie: cookieOf(res) } });
  // /account redirects to /login when signed out.
  if (me.status !== 200) return null;
  const token = cookieOf(res).split("=")[1]!;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return (await kv.get(`sess:${hash}`)) as string | null;
}

function expectLogin(res: Response, next = "/account") {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe(`${ORIGIN}/login?next=${encodeURIComponent(next)}`);
  expect(res.headers.get("set-cookie")).toBeNull();
}

describe("GET /auth/handoff (AdVault -> SiteVault)", () => {
  let linked: Account;
  beforeEach(async () => {
    linked = await accountForAdvault(KVNS(), { advaultUserId: ADV_ID, email: EMAIL });
  });

  it("signs the linked account in with the normal cookie and goes to `to`", async () => {
    const res = await call(handoffUrl(await fromAdvault(ADV_ID, "Owner@Example.com"), "/edit/green-lawns"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/edit/green-lawns`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^sv_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(await sessionAccountId(res)).toBe(linked.id);
  });

  it("defaults to /account and refuses an open redirect in `to`", async () => {
    expect((await call(handoffUrl(await fromAdvault(ADV_ID, EMAIL)))).headers.get("location")).toBe(`${ORIGIN}/account`);
    for (const bad of ["https://evil.test/", "//evil.test", "/\\evil.test", "javascript:alert(1)", "account"]) {
      const res = await call(handoffUrl(await fromAdvault(ADV_ID, EMAIL), bad));
      expect(res.headers.get("location"), bad).toBe(`${ORIGIN}/account`);
    }
  });

  it("works once: the second use goes to the sign-in page", async () => {
    const t = await fromAdvault(ADV_ID, EMAIL);
    expect((await call(handoffUrl(t))).status).toBe(303);
    expectLogin(await call(handoffUrl(t)));
  });

  it("HEAD never uses the token up", async () => {
    const t = await fromAdvault(ADV_ID, EMAIL);
    const head = await call(handoffUrl(t), { method: "HEAD" });
    expect(head.headers.get("set-cookie")).toBeNull();
    expect((await call(handoffUrl(t))).headers.get("set-cookie")).toMatch(/^sv_session=/);
  });

  it("refuses an expired, too long-lived or future token", async () => {
    expectLogin(await call(handoffUrl(await fromAdvault(ADV_ID, EMAIL, Date.now() - 61_000))));
    const iat = Math.floor(Date.now() / 1000);
    const base: SigninToken = { v: 1, purpose: "signin-sitevault", uid: ADV_ID, email: EMAIL, iat, exp: iat + 600, nonce: "n".repeat(20) };
    expectLogin(await call(handoffUrl(await signSigninToken(TOKEN, base))));
    expectLogin(await call(handoffUrl(await signSigninToken(TOKEN, { ...base, nonce: "f".repeat(20), iat: iat + 120, exp: iat + 150 }))));
  });

  it("refuses the other direction's token and the embed editor/create tokens", async () => {
    expectLogin(await call(handoffUrl(await mintSigninToken(TOKEN, "signin-advault", { uid: ADV_ID, email: EMAIL }))));
    const iat = Math.floor(Date.now() / 1000);
    expectLogin(await call(handoffUrl(await signHandoff(TOKEN, { v: 1, uid: ADV_ID, email: EMAIL, slug: "green-lawns", iat, exp: iat + 60, jti: "j".repeat(20) }))));
    const create = await signCreateHandoff(TOKEN, { v: 1, purpose: "create", uid: ADV_ID, email: EMAIL, campaignId: ADV_ID, draft: "d".repeat(20), pay: false, iat, exp: iat + 60, jti: "k".repeat(20) });
    expectLogin(await call(handoffUrl(create)));
    // Right purpose, but MACed under the editor prefix.
    const forged = await signHandoff(TOKEN, { v: 1, purpose: "signin-sitevault", uid: ADV_ID, email: EMAIL, iat, exp: iat + 60, nonce: "m".repeat(20) } as never);
    expectLogin(await call(handoffUrl(forged)));
  });

  it("refuses a tampered MAC or payload and another secret", async () => {
    const good = await fromAdvault(ADV_ID, EMAIL);
    const other = await fromAdvault(TEST_ID, EMAIL);
    expectLogin(await call(handoffUrl(`${other.split(".")[0]}.${good.split(".")[1]}`)));
    const sig = good.split(".")[1]!;
    expectLogin(await call(handoffUrl(`${good.split(".")[0]}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`)));
    expectLogin(await call(handoffUrl(await mintSigninToken("another-secret", "signin-sitevault", { uid: ADV_ID, email: EMAIL }))));
    expectLogin(await call(handoffUrl("nonsense")));
    // The untouched token still works.
    expect((await call(handoffUrl(good))).headers.get("set-cookie")).toMatch(/^sv_session=/);
  });

  it("refuses an unknown AdVault user and never creates or merges by email", async () => {
    const before = kv.data.size;
    // A SiteVault account with the same email but linked to nobody.
    await createAccount(KVNS(), "solo@example.com", null);
    expectLogin(await call(handoffUrl(await fromAdvault("44444444-2222-3333-4444-555555555555", "solo@example.com"))));
    expect([...kv.data.keys()].some((k) => k.startsWith("acctadv:44444444"))).toBe(false);
    expect(kv.data.size).toBe(before + 2 + 1); // the solo account (acct + acctemail) + the used nonce
  });

  it("refuses when the email no longer matches", async () => {
    expectLogin(await call(handoffUrl(await fromAdvault(ADV_ID, "someone-else@example.com"))));
    expectLogin(await call(handoffUrl(await fromAdvault(ADV_ID, ""))));
  });

  it("refuses admin accounts (they sign in by hand)", async () => {
    await accountForAdvault(KVNS(), { advaultUserId: ADMIN_ID, email: ADMIN_EMAIL });
    expectLogin(await call(handoffUrl(await fromAdvault(ADMIN_ID, ADMIN_EMAIL))));
  });

  it("signs an AdVault test customer (id-only account) in by id, with no email", async () => {
    const test = await accountForAdvault(KVNS(), { advaultUserId: TEST_ID, email: "tc@test-customer.invalid" });
    const res = await call(handoffUrl(await fromAdvault(TEST_ID, "")));
    expect(res.headers.get("set-cookie")).toMatch(/^sv_session=/);
    expect(await sessionAccountId(res)).toBe(test.id);
    // A real email in the token never reaches an id-only account.
    expectLogin(await call(handoffUrl(await fromAdvault(TEST_ID, EMAIL))));
  });

  it("refuses everything while INTERNAL_TOKEN is unset", async () => {
    const t = await fromAdvault(ADV_ID, EMAIL);
    delete env.INTERNAL_TOKEN;
    expectLogin(await call(handoffUrl(t)));
  });
});

describe("GET /go/advault (SiteVault -> AdVault)", () => {
  const go = (cookie?: string, to?: string) =>
    call(`${ORIGIN}/go/advault${to === undefined ? "" : `?to=${encodeURIComponent(to)}`}`, cookie ? { headers: { cookie } } : {});
  const signedIn = async (a: Account) => `sv_session=${await startSession(KVNS(), a.id)}`;

  it("keeps the #delete-account section for My website's Delete my account", async () => {
    const a = await accountForAdvault(KVNS(), { advaultUserId: ADV_ID, email: EMAIL });
    const res = await go(await signedIn(a), "/dashboard/settings#delete-account");
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe("https://advault.3pandalabs.com/auth/handoff");
    expect(loc.searchParams.get("to")).toBe("/dashboard/settings#delete-account");
    // Not signed in: AdVault's own page (it asks them to sign in).
    expect((await go(undefined, "/dashboard/settings#delete-account")).headers.get("location")).toBe(
      "https://advault.3pandalabs.com/dashboard/settings#delete-account",
    );
  });

  it("mints a 60 s signin-advault token for a linked owner -> AdVault /auth/handoff", async () => {
    const a = await accountForAdvault(KVNS(), { advaultUserId: ADV_ID, email: EMAIL });
    const res = await go(await signedIn(a), "/dashboard/campaigns/new");
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const loc = new URL(res.headers.get("location")!);
    expect(`${loc.origin}${loc.pathname}`).toBe("https://advault.3pandalabs.com/auth/handoff");
    expect(loc.searchParams.get("to")).toBe("/dashboard/campaigns/new");
    const checked = await verifySigninToken(TOKEN, loc.searchParams.get("t")!, "signin-advault");
    expect(checked.ok && checked.token).toMatchObject({ uid: ADV_ID, email: EMAIL });
    if (checked.ok) expect(checked.token.exp - checked.token.iat).toBe(60);
    // It is no good back here.
    expectLogin(await call(handoffUrl(loc.searchParams.get("t")!)));
  });

  it("falls back to the plain AdVault page: signed out, unlinked, admin, test customer, HEAD, unconfigured", async () => {
    const plain = "https://advault.3pandalabs.com/dashboard";
    expect((await go()).headers.get("location")).toBe(plain);
    const solo = (await createAccount(KVNS(), "solo@example.com", null)) as Account;
    expect((await go(await signedIn(solo))).headers.get("location")).toBe(plain);
    const admin = await accountForAdvault(KVNS(), { advaultUserId: ADMIN_ID, email: ADMIN_EMAIL });
    expect((await go(await signedIn(admin))).headers.get("location")).toBe(plain);
    const test = await accountForAdvault(KVNS(), { advaultUserId: TEST_ID, email: "" });
    expect((await go(await signedIn(test))).headers.get("location")).toBe(plain);
    const linked = await accountForAdvault(KVNS(), { advaultUserId: ADV_ID, email: EMAIL });
    expect((await call(`${ORIGIN}/go/advault`, { method: "HEAD", headers: { cookie: await signedIn(linked) } })).headers.get("location")).toBe(plain);
    delete env.INTERNAL_TOKEN;
    expect((await go(await signedIn(linked))).headers.get("location")).toBe(plain);
  });

  it("never redirects off AdVault (`to` sanitised)", async () => {
    const a = await accountForAdvault(KVNS(), { advaultUserId: ADV_ID, email: EMAIL });
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "evil"]) {
      const loc = new URL((await go(await signedIn(a), bad)).headers.get("location")!);
      expect(loc.origin).toBe("https://advault.3pandalabs.com");
      expect(loc.searchParams.get("to")).toBe("/dashboard");
    }
  });

  it("the signed-in header and home page link through it; signed out stays plain", async () => {
    const a = await accountForAdvault(KVNS(), { advaultUserId: ADV_ID, email: EMAIL });
    const home = await (await call(`${ORIGIN}/`, { headers: { cookie: await signedIn(a) } })).text();
    expect(home).toContain('href="/go/advault?to=/dashboard">Video ads</a>');
    expect(home).toMatch(/href="\/go\/advault\?to=\/dashboard">Make a YouTube ad/);
    const out = await (await call(`${ORIGIN}/`)).text();
    expect(out).not.toContain("/go/advault");
    expect(out).toMatch(/href="https:\/\/advault\.3pandalabs\.com">Make a YouTube ad/);
  });
});

describe("safeLocalPath", () => {
  it("keeps local paths only", () => {
    expect(safeLocalPath("/edit/green-lawns?x=1", "/a")).toBe("/edit/green-lawns?x=1");
    for (const bad of [null, undefined, "", "x", "//e.test", "/\\e", "https://e.test", "/a b", "/a\nb"]) expect(safeLocalPath(bad, "/a")).toBe("/a");
  });
});
