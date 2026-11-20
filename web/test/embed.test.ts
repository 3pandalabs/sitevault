// Embedded editor + AdVault sign-in handoff (2026-11-19, "Option A"). The
// whole fetch handler with in-memory KV/R2, like worker.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { EMBED_PARENT_ORIGIN, signHandoff, verifyHandoff, type Handoff } from "../src/embed.js";

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

function memoryR2() {
  const data = new Map<string, ArrayBuffer>();
  return {
    data,
    async put(key: string, value: ArrayBuffer) {
      data.set(key, value);
    },
    async get(key: string) {
      const v = data.get(key);
      return v ? { body: new Uint8Array(v), size: v.byteLength, httpMetadata: {} } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
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
const OTHER_ID = "99999999-2222-3333-4444-555555555555";
const EMAIL = "owner@example.com";

beforeEach(() => {
  kv = memoryKv();
  pending = [];
  env = {
    SITES: kv,
    PHOTOS: memoryR2(),
    PUBLIC_ORIGIN: ORIGIN,
    SITES_DOMAIN: "3pandasite.test",
    INTERNAL_TOKEN: TOKEN,
    // On, so the test proves billing is hidden in embed mode, not just absent.
    BILLING: "on",
  };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

async function makeSite(owner: { id: string; email: string }, slug: string, phone = "(555) 201-0000"): Promise<string> {
  const form = new FormData();
  const fields = { businessName: "Green Lawns", category: "landscaping", phone, city: "Edison", slug, ownerAdvaultUserId: owner.id, ownerEmail: owner.email };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slug: string }).slug;
}

const now = () => Math.floor(Date.now() / 1000);
let jtiN = 0;
function handoff(over: Partial<Handoff> = {}): Handoff {
  jtiN += 1;
  return { v: 1, uid: ADV_ID, email: EMAIL, slug: "green-lawns", iat: now(), exp: now() + 60, jti: `jti-${String(jtiN).padStart(16, "0")}`, ...over };
}
const sessionUrl = (token: string) => `${ORIGIN}/embed/session?token=${encodeURIComponent(token)}`;
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("verifyHandoff", () => {
  it("accepts a fresh token signed with the shared secret", async () => {
    const r = await verifyHandoff(TOKEN, await signHandoff(TOKEN, handoff()));
    expect(r.ok).toBe(true);
  });

  it("refuses expired, too long-lived, future, tampered, wrong-secret and malformed tokens", async () => {
    const expired = await signHandoff(TOKEN, handoff({ iat: now() - 120, exp: now() - 60 }));
    expect(await verifyHandoff(TOKEN, expired)).toEqual({ ok: false, error: "expired" });
    const longLived = await signHandoff(TOKEN, handoff({ exp: now() + 3600 }));
    expect(await verifyHandoff(TOKEN, longLived)).toEqual({ ok: false, error: "expired" });
    const future = await signHandoff(TOKEN, handoff({ iat: now() + 600, exp: now() + 660 }));
    expect(await verifyHandoff(TOKEN, future)).toEqual({ ok: false, error: "expired" });
    // Swap the payload for another slug's, keep the signature.
    const good = await signHandoff(TOKEN, handoff());
    const other = await signHandoff(TOKEN, handoff({ slug: "someone-else" }));
    const tampered = `${other.split(".")[0]}.${good.split(".")[1]}`;
    expect(await verifyHandoff(TOKEN, tampered)).toEqual({ ok: false, error: "bad_signature" });
    expect(await verifyHandoff(TOKEN, await signHandoff("another-secret", handoff()))).toEqual({ ok: false, error: "bad_signature" });
    expect((await verifyHandoff(TOKEN, "nonsense")).ok).toBe(false);
    expect((await verifyHandoff(TOKEN, "")).ok).toBe(false);
    expect(await verifyHandoff(undefined, good)).toEqual({ ok: false, error: "not_configured" });
  });
});

describe("GET /embed/session", () => {
  it("signs the owner in (same cookie attributes) and opens the embed editor", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const res = await call(sessionUrl(await signHandoff(TOKEN, handoff({ slug }))));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/edit/${slug}?embed=1`);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^sv_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("refuses an expired token", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const res = await call(sessionUrl(await signHandoff(TOKEN, handoff({ slug, iat: now() - 90, exp: now() - 30 }))));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a reused token", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const token = await signHandoff(TOKEN, handoff({ slug }));
    expect((await call(sessionUrl(token))).status).toBe(303);
    const again = await call(sessionUrl(token));
    expect(again.status).toBe(403);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("a HEAD (link checker) does not use the token up", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const token = await signHandoff(TOKEN, handoff({ slug }));
    const head = await call(sessionUrl(token), { method: "HEAD" });
    expect(head.headers.get("set-cookie")).toBeNull();
    expect((await call(sessionUrl(token))).status).toBe(303);
  });

  it("refuses a tampered token", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const token = await signHandoff(TOKEN, handoff({ slug }));
    const [payload, sig] = token.split(".") as [string, string];
    const flipped = `${payload}.${sig.startsWith("A") ? "B" : "A"}${sig.slice(1)}`;
    const res = await call(sessionUrl(flipped));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    // Signed by anyone without the shared secret.
    expect((await call(sessionUrl(await signHandoff("guess", handoff({ slug }))))).status).toBe(403);
  });

  it("refuses a site owned by another account", async () => {
    await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    await makeSite({ id: OTHER_ID, email: "other@example.com" }, "other-lawns", "(555) 201-0001");
    // A valid token for ADV_ID, naming the other account's site.
    const res = await call(sessionUrl(await signHandoff(TOKEN, handoff({ slug: "other-lawns" }))));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    // And an AdVault user with no SiteVault account at all.
    const stranger = await call(sessionUrl(await signHandoff(TOKEN, handoff({ uid: "aaaaaaaa-0000-0000-0000-000000000000", email: "x@example.com" }))));
    expect(stranger.status).toBe(403);
  });

  it("refuses a site built on SiteVault (embed is for AdVault-made sites)", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const site = JSON.parse(kv.data.get(`site:${slug}`)!.value);
    await kv.put(`site:${slug}`, JSON.stringify({ ...site, source: "web" }));
    expect((await call(sessionUrl(await signHandoff(TOKEN, handoff({ slug }))))).status).toBe(403);
  });

  it("503 while INTERNAL_TOKEN is unset", async () => {
    env.INTERNAL_TOKEN = undefined;
    expect((await call(sessionUrl("a.b"))).status).toBe(503);
  });
});

describe("embed editor", () => {
  async function signIn(): Promise<{ slug: string; cookie: string }> {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const res = await call(sessionUrl(await signHandoff(TOKEN, handoff({ slug }))));
    return { slug, cookie: cookieOf(res) };
  }

  it("only AdVault may frame it; the normal edit page still refuses framing", async () => {
    const { slug, cookie } = await signIn();
    const embed = await call(`${ORIGIN}/edit/${slug}?embed=1`, { headers: { cookie } });
    expect(embed.status).toBe(200);
    const csp = embed.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`frame-ancestors ${EMBED_PARENT_ORIGIN}`);
    expect(csp).not.toContain("frame-ancestors 'none'");
    const normal = await call(`${ORIGIN}/edit/${slug}`, { headers: { cookie } });
    expect(normal.status).toBe(200);
    expect(normal.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await call(`${ORIGIN}/`)).headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("keeps the editor but hides SiteVault's header, nav, footer, billing and upsell", async () => {
    const { slug, cookie } = await signIn();
    const page = await (await call(`${ORIGIN}/edit/${slug}?embed=1`, { headers: { cookie } })).text();
    expect(page).toContain('id="builder"');
    expect(page).toContain('name="embed" value="1"');
    expect(page).toContain('name="offer"');
    expect(page).toContain('name="services"');
    expect(page).toContain('name="hours"');
    expect(page).toContain('name="photos"');
    expect(page).toContain('name="video"');
    expect(page).toContain('name="faq"');
    expect(page).toContain("sitevault:height");
    // AdVault opens a new site's editor at the style picker.
    expect(page).toContain('id="website-style"');
    expect(page).toContain("sitevault:sections");
    expect(page).not.toContain('<header class="top">');
    expect(page).not.toContain("<footer>");
    expect(page).not.toContain("Sign out");
    expect(page).not.toContain("Plan &amp; billing");
    expect(page).not.toContain("/api/billing/");
    expect(page).not.toContain("Manage billing");
    expect(page).not.toMatch(/credit \(\d+ left\)/);
    // The same page outside embed mode still has all of it.
    const normal = await (await call(`${ORIGIN}/edit/${slug}`, { headers: { cookie } })).text();
    expect(normal).toContain('<header class="top">');
    expect(normal).toContain("Plan &amp; billing");
  });

  it("without a session it asks to reopen from AdVault: no sign-in form, no redirect", async () => {
    const slug = await makeSite({ id: ADV_ID, email: EMAIL }, "green-lawns");
    const res = await call(`${ORIGIN}/edit/${slug}?embed=1`);
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain(`frame-ancestors ${EMBED_PARENT_ORIGIN}`);
    const body = await res.text();
    expect(body).toContain("open Your website again");
    expect(body).not.toContain('name="password"');
  });

  it("a save stays in embed mode and says so", async () => {
    const { slug, cookie } = await signIn();
    const form = new FormData();
    const fields = { businessName: "Green Lawns Co", category: "landscaping", phone: "(555) 201-0000", city: "Edison", attest: "yes", embed: "1", key: "" };
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const res = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", headers: { cookie, origin: ORIGIN, accept: "application/json" }, body: form });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { next: string }).next).toBe(`${ORIGIN}/edit/${slug}?embed=1&saved=1`);
    expect(JSON.parse(kv.data.get(`site:${slug}`)!.value).businessName).toBe("Green Lawns Co");
    const saved = await (await call(`${ORIGIN}/edit/${slug}?embed=1&saved=1`, { headers: { cookie } })).text();
    expect(saved).toContain('id="embed-saved"');
    // Without JavaScript: a 303 back to the embed editor.
    const plain = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: form });
    expect(plain.status).toBe(303);
    expect(plain.headers.get("location")).toBe(`${ORIGIN}/edit/${slug}?embed=1&saved=1`);
  });

  it("a session-only save from another origin is refused (unchanged)", async () => {
    const { slug, cookie } = await signIn();
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Hacked", category: "landscaping", phone: "(555) 201-0000", city: "Edison", attest: "yes", embed: "1" })) form.set(k, v);
    const res = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", headers: { cookie, origin: EMBED_PARENT_ORIGIN, accept: "application/json" }, body: form });
    expect(res.status).toBe(403);
  });
});
