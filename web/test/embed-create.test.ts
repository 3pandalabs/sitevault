// AdVault create mode (2026-11-19): the full builder embedded in AdVault's
// "Make me a website", pre-filled from a server-to-server draft. Whole fetch
// handler with in-memory KV/R2, like embed.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { EMBED_PARENT_ORIGIN, signCreateHandoff, signHandoff, verifyCreateHandoff, type CreateHandoff } from "../src/embed.js";

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
  const data = new Map<string, { bytes: Uint8Array; type?: string }>();
  const toBytes = async (v: unknown): Promise<Uint8Array> =>
    typeof v === "string" ? new TextEncoder().encode(v) : v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(await new Response(v as BodyInit).arrayBuffer());
  return {
    data,
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      data.set(key, { bytes: await toBytes(value), type: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const v = data.get(key);
      if (!v) return null;
      return {
        body: v.bytes,
        size: v.bytes.byteLength,
        httpMetadata: { contentType: v.type },
        async text() {
          return new TextDecoder().decode(v.bytes);
        },
        async arrayBuffer() {
          return v.bytes.slice().buffer;
        },
      };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

let kv: ReturnType<typeof memoryKv>;
let r2: ReturnType<typeof memoryR2>;
let env: Record<string, unknown>;
let pending: Promise<unknown>[];
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }) as unknown as ExecutionContext;

const ORIGIN = "https://sitevault.test";
const TOKEN = "internal-token";
const ADV_ID = "11111111-2222-3333-4444-555555555555";
const OTHER_ID = "99999999-2222-3333-4444-555555555555";
const CAMPAIGN = "cccccccc-2222-3333-4444-555555555555";
const EMAIL = "owner@example.com";
const auth = { authorization: `Bearer ${TOKEN}` };

beforeEach(() => {
  kv = memoryKv();
  r2 = memoryR2();
  pending = [];
  env = { SITES: kv, PHOTOS: r2, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: TOKEN, BILLING: "on" };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

const jpeg = (name: string) => new File([new Uint8Array(12)], name, { type: "image/jpeg" });

async function makeDraft(over: Record<string, string> = {}, files: Record<string, File | File[]> = {}): Promise<string> {
  const form = new FormData();
  const fields = {
    campaignId: CAMPAIGN,
    ownerAdvaultUserId: ADV_ID,
    ownerEmail: EMAIL,
    businessName: "Green Lawns",
    category: "landscaping",
    city: "Edison, NJ",
    offer: "Spring cleanup $149",
    services: "Lawn mowing - from $35",
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [k, v] of Object.entries(files)) for (const f of Array.isArray(v) ? v : [v]) form.append(k, f);
  const res = await call(`${ORIGIN}/api/internal/drafts`, { method: "POST", headers: auth, body: form });
  expect(res.status).toBe(201);
  return ((await res.json()) as { draftId: string }).draftId;
}

const now = () => Math.floor(Date.now() / 1000);
let jtiN = 0;
function createHandoff(draft: string, over: Partial<CreateHandoff> = {}): CreateHandoff {
  jtiN += 1;
  return { v: 1, purpose: "create", uid: ADV_ID, email: EMAIL, campaignId: CAMPAIGN, draft, pay: false, iat: now(), exp: now() + 60, jti: `cjti-${String(jtiN).padStart(16, "0")}`, ...over };
}
const newUrl = (token: string) => `${ORIGIN}/embed/new?token=${encodeURIComponent(token)}`;
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0]!;

async function openBuilder(draft: string, over: Partial<CreateHandoff> = {}): Promise<{ cookie: string; page: Response }> {
  const res = await call(newUrl(await signCreateHandoff(TOKEN, createHandoff(draft, over))));
  expect(res.status).toBe(303);
  const cookie = cookieOf(res);
  return { cookie, page: await call(res.headers.get("location")!, { headers: { cookie } }) };
}

function builderForm(draft: string, keep: string[] = [], extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  const fields = { draft, businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison, NJ", attest: "yes", ...extra };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const k of keep) form.append("keepDraft", k);
  return form;
}

const submit = (form: FormData, cookie: string, origin = ORIGIN) =>
  call(`${ORIGIN}/api/embed/sites`, { method: "POST", headers: { cookie, origin, accept: "application/json" }, body: form });

const draftJson = (id: string) => JSON.parse(new TextDecoder().decode(r2.data.get(`drafts/${id}/draft.json`)!.bytes));

describe("verifyCreateHandoff", () => {
  it("accepts a fresh create token", async () => {
    expect((await verifyCreateHandoff(TOKEN, await signCreateHandoff(TOKEN, createHandoff("d".repeat(24))))).ok).toBe(true);
  });

  it("refuses expired, tampered, wrong-purpose and edit tokens", async () => {
    const d = "d".repeat(24);
    expect(await verifyCreateHandoff(TOKEN, await signCreateHandoff(TOKEN, createHandoff(d, { iat: now() - 120, exp: now() - 60 })))).toEqual({ ok: false, error: "expired" });
    expect(await verifyCreateHandoff(TOKEN, await signCreateHandoff(TOKEN, createHandoff(d, { exp: now() + 3600 })))).toEqual({ ok: false, error: "expired" });
    const good = await signCreateHandoff(TOKEN, createHandoff(d));
    const other = await signCreateHandoff(TOKEN, createHandoff(d, { uid: OTHER_ID }));
    expect(await verifyCreateHandoff(TOKEN, `${other.split(".")[0]}.${good.split(".")[1]}`)).toEqual({ ok: false, error: "bad_signature" });
    // Correctly signed, but not a create token.
    const wrongPurpose = await signCreateHandoff(TOKEN, createHandoff(d, { purpose: "edit" as "create" }));
    expect(await verifyCreateHandoff(TOKEN, wrongPurpose)).toEqual({ ok: false, error: "malformed" });
    // An edit handoff (sv-embed-v1.) never verifies as a create token.
    const edit = await signHandoff(TOKEN, { v: 1, uid: ADV_ID, email: EMAIL, slug: "green-lawns", iat: now(), exp: now() + 60, jti: "e".repeat(20) });
    expect(await verifyCreateHandoff(TOKEN, edit)).toEqual({ ok: false, error: "bad_signature" });
    expect(await verifyCreateHandoff(undefined, good)).toEqual({ ok: false, error: "not_configured" });
  });

  it("a create token cannot sign in to an editor, and an edit token cannot open the builder", async () => {
    const id = await makeDraft();
    const create = await signCreateHandoff(TOKEN, createHandoff(id));
    expect((await call(`${ORIGIN}/embed/session?token=${encodeURIComponent(create)}`)).status).toBe(403);
    const edit = await signHandoff(TOKEN, { v: 1, uid: ADV_ID, email: EMAIL, slug: "green-lawns", iat: now(), exp: now() + 60, jti: "f".repeat(20) });
    const res = await call(newUrl(edit));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("drafts (server to server)", () => {
  it("needs the internal token and a real owner email", async () => {
    const form = new FormData();
    form.set("campaignId", CAMPAIGN);
    expect((await call(`${ORIGIN}/api/internal/drafts`, { method: "POST", body: form })).status).toBe(401);
    const f2 = new FormData();
    for (const [k, v] of Object.entries({ campaignId: CAMPAIGN, ownerAdvaultUserId: ADV_ID })) f2.set(k, v);
    const res = await call(`${ORIGIN}/api/internal/drafts`, { method: "POST", headers: auth, body: f2 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("email_required");
  });

  it("the result is readable only for the draft's own AdVault user", async () => {
    const id = await makeDraft();
    const mine = await call(`${ORIGIN}/api/internal/drafts/${id}?advaultUserId=${ADV_ID}`, { headers: auth });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ ok: true, campaignId: CAMPAIGN, result: null });
    expect((await call(`${ORIGIN}/api/internal/drafts/${id}?advaultUserId=${OTHER_ID}`, { headers: auth })).status).toBe(404);
    expect((await call(`${ORIGIN}/api/internal/drafts/${id}?advaultUserId=${ADV_ID}`)).status).toBe(401);
  });
});

describe("GET /embed/new", () => {
  it("opens the full builder, pre-filled, in embed chrome, framable by AdVault only", async () => {
    const id = await makeDraft({}, { photos: [jpeg("a.jpg"), jpeg("b.jpg")] });
    const { page } = await openBuilder(id);
    expect(page.status).toBe(200);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`frame-ancestors ${EMBED_PARENT_ORIGIN}`);
    const html = await page.text();
    expect(html).toContain('action="/api/embed/sites"');
    expect(html).toContain(`name="draft" value="${id}"`);
    expect(html).toContain('value="Green Lawns"');
    expect(html).toContain("Spring cleanup $149");
    // Every builder option is there.
    for (const name of ["offer", "services", "hours", "about", "photos", "video", "faq", "template", "slug", "locations"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('id="website-style"');
    expect(html.match(/name="keepDraft"/g)?.length).toBe(2);
    expect(html).toContain('name="attest"');
    expect(html).toContain("sitevault:height");
    // No SiteVault chrome, sign-up fields or prices.
    expect(html).not.toContain('<header class="top">');
    expect(html).not.toContain("<footer>");
    expect(html).not.toContain('name="acct_email"');
    expect(html).not.toContain('name="acct_password"');
    expect(html).not.toContain("/api/billing/");
    expect(html).not.toMatch(/\$\d+ ?\/ ?y(ea)?r/);
    // The normal builder and home page still refuse framing.
    expect((await call(`${ORIGIN}/new`)).headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await call(`${ORIGIN}/`)).headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("serves draft photos to that session only", async () => {
    const id = await makeDraft({}, { photos: [jpeg("a.jpg")] });
    const { cookie } = await openBuilder(id);
    const key = draftJson(id).photos[0].key as string;
    const url = `${ORIGIN}/embed/draft/${id}/${key.split("/").pop()}`;
    expect((await call(url, { headers: { cookie } })).status).toBe(200);
    expect((await call(url)).status).toBe(404);
  });

  it("refuses a reused, expired or other user's token, framably", async () => {
    const id = await makeDraft();
    const token = await signCreateHandoff(TOKEN, createHandoff(id));
    expect((await call(newUrl(token))).status).toBe(303);
    const again = await call(newUrl(token));
    expect(again.status).toBe(403);
    expect(again.headers.get("set-cookie")).toBeNull();
    expect(again.headers.get("content-security-policy")).toContain(`frame-ancestors ${EMBED_PARENT_ORIGIN}`);
    expect((await call(newUrl(await signCreateHandoff(TOKEN, createHandoff(id, { iat: now() - 90, exp: now() - 30 }))))).status).toBe(403);
    // Valid signature, but the draft belongs to someone else / another campaign / other pay flag.
    expect((await call(newUrl(await signCreateHandoff(TOKEN, createHandoff(id, { uid: OTHER_ID, email: "o@example.com" }))))).status).toBe(403);
    expect((await call(newUrl(await signCreateHandoff(TOKEN, createHandoff(id, { campaignId: OTHER_ID }))))).status).toBe(403);
    expect((await call(newUrl(await signCreateHandoff(TOKEN, createHandoff(id, { pay: true }))))).status).toBe(403);
  });

  it("without the session it asks to reopen from AdVault", async () => {
    const id = await makeDraft();
    const res = await call(`${ORIGIN}/embed/new?draft=${id}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Make me a website again");
  });
});

describe("POST /api/embed/sites", () => {
  it("creates exactly like internal create: source advault, owner linked, pending when AdVault charges", async () => {
    const id = await makeDraft({ awaitingPayment: "1" }, { photos: [jpeg("a.jpg"), jpeg("b.jpg")], ba1Before: jpeg("1b.jpg"), ba1After: jpeg("1a.jpg") });
    const { cookie } = await openBuilder(id, { pay: true });
    const keys = draftJson(id).photos.map((p: { key: string }) => p.key) as string[];
    // The owner drops the first ad photo and keeps the second; keeps the pair.
    const form = builderForm(id, [keys[1]!], { tagline: "Family-owned since 2009" });
    form.append("keepDraftPair", "0");
    const res = await submit(form, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; next: string };
    expect(body.next).toBe(`${ORIGIN}/embed/created?draft=${id}`);
    const slugKey = [...kv.data.keys()].find((k) => k.startsWith("site:"))!;
    const site = JSON.parse(kv.data.get(slugKey)!.value);
    expect(site.source).toBe("advault");
    expect(site.tagline).toBe("Family-owned since 2009");
    expect(site.billing.status).toBe("pending");
    expect(site.photos).toHaveLength(1);
    expect(site.photos[0]).toMatch(new RegExp(`^sites/${site.slug}/`));
    expect(site.beforeAfter).toHaveLength(1);
    expect(site.beforeAfter[0].before).toMatch(new RegExp(`^sites/${site.slug}/`));
    // Owner = the AdVault user's linked account.
    const acctId = kv.data.get(`acctadv:${ADV_ID}`)!.value;
    expect(site.ownerId).toBe(acctId);
    expect(JSON.parse(kv.data.get(`acct:${acctId}`)!.value).sites).toContain(site.slug);
    // Draft media gone; the result is readable server to server.
    expect([...r2.data.keys()].filter((k) => k.startsWith(`drafts/${id}/`))).toEqual([`drafts/${id}/draft.json`]);
    const result = (await (await call(`${ORIGIN}/api/internal/drafts/${id}?advaultUserId=${ADV_ID}`, { headers: auth })).json()) as { result: { slug: string; pending: boolean; editUrl: string } };
    expect(result.result).toMatchObject({ slug: site.slug, pending: true });
    expect(result.result.editUrl).toContain(`/edit/${site.slug}?k=`);
    // The created page tells AdVault (origin-only script) and is framable.
    const created = await call(body.next, { headers: { cookie } });
    expect(created.headers.get("content-security-policy")).toContain(`frame-ancestors ${EMBED_PARENT_ORIGIN}`);
    const html = await created.text();
    expect(html).toContain('id="embed-created"');
    expect(html).toContain(`data-slug="${site.slug}"`);
    expect(html).toContain('data-pending="1"');
    expect(html).toContain("sitevault:created");
  });

  it("is live at once when AdVault doesn't charge", async () => {
    const id = await makeDraft();
    const { cookie } = await openBuilder(id);
    expect((await submit(builderForm(id), cookie)).status).toBe(200);
    const site = JSON.parse([...kv.data.entries()].find(([k]) => k.startsWith("site:"))![1].value);
    expect(site.billing.status).toBe("active");
    expect(draftJson(id).result.pending).toBe(false);
  });

  it("keeps the builder's rules: attest tick, no links, phone", async () => {
    const id = await makeDraft();
    const { cookie } = await openBuilder(id);
    const noTick = builderForm(id);
    noTick.delete("attest");
    expect(((await (await submit(noTick, cookie)).json()) as { errors: Record<string, string> }).errors.attest).toBeTruthy();
    const link = await submit(builderForm(id, [], { about: "See www.scam-example.com" }), cookie);
    expect(link.status).toBe(400);
    expect([...kv.data.keys()].some((k) => k.startsWith("site:"))).toBe(false);
  });

  it("refuses another origin and a missing session", async () => {
    const id = await makeDraft();
    const { cookie } = await openBuilder(id);
    expect((await submit(builderForm(id), cookie, EMBED_PARENT_ORIGIN)).status).toBe(403);
    expect((await submit(builderForm(id), "")).status).toBe(403);
    expect([...kv.data.keys()].some((k) => k.startsWith("site:"))).toBe(false);
  });

  it("one website per account: a second draft can't make another", async () => {
    const first = await makeDraft();
    const { cookie } = await openBuilder(first);
    expect((await submit(builderForm(first), cookie)).status).toBe(200);
    // Opening the builder again for this account says it already has one.
    const second = await makeDraft();
    const res = await call(newUrl(await signCreateHandoff(TOKEN, createHandoff(second))));
    expect(res.status).toBe(409);
    expect(res.headers.get("content-security-policy")).toContain(`frame-ancestors ${EMBED_PARENT_ORIGIN}`);
    // And a submit from a builder opened before the first site was made is refused too.
    const third = await makeDraft();
    const draft = draftJson(third);
    await r2.put(`drafts/${third}/draft.json`, JSON.stringify({ ...draft, accountId: kv.data.get(`acctadv:${ADV_ID}`)!.value }));
    const late = await submit(builderForm(third, [], { phone: "(555) 201-0099" }), cookie);
    expect(late.status).toBe(409);
    expect([...kv.data.keys()].filter((k) => k.startsWith("site:"))).toHaveLength(1);
  });

  it("one site per draft: a second submit goes to Created, nothing new is made", async () => {
    const id = await makeDraft({ ownerAdmin: "1" });
    const { cookie } = await openBuilder(id);
    expect((await submit(builderForm(id), cookie)).status).toBe(200);
    expect((await submit(builderForm(id, [], { phone: "(555) 201-0002" }), cookie)).status).toBe(200);
    expect([...kv.data.keys()].filter((k) => k.startsWith("site:"))).toHaveLength(1);
  });
});
