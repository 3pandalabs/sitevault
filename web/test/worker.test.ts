// Worker-level tests (QA 2026-11-16): the whole fetch handler with an
// in-memory KV and R2, no network. Covers HEAD on customer sites and the main
// site, the one-time /done handoff, the account-site lookup AdVault uses,
// one website per account on internal create, and /metrics uptime.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";

type KvEntry = { value: string; metadata?: unknown };

function memoryKv() {
  const data = new Map<string, KvEntry>();
  const kv = {
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
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
  return kv;
}

function memoryR2() {
  const data = new Map<string, ArrayBuffer>();
  const types = new Map<string, string>();
  return {
    data,
    async put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }) {
      data.set(key, value);
      if (opts?.httpMetadata?.contentType) types.set(key, opts.httpMetadata.contentType);
    },
    async get(key: string) {
      const v = data.get(key);
      if (!v) return null;
      return { body: new Uint8Array(v), size: v.byteLength, httpMetadata: { contentType: types.get(key) } };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

/** A D1 stub that only counts writes (visit stats). */
function countingD1() {
  const d1 = {
    writes: 0,
    prepare() {
      return { bind: () => ({ run: async () => void (d1.writes += 1) }) };
    },
  };
  return d1;
}

let kv: ReturnType<typeof memoryKv>;
let stats: ReturnType<typeof countingD1>;
let env: Record<string, unknown>;
let pending: Promise<unknown>[];
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }) as unknown as ExecutionContext;

const ORIGIN = "https://sitevault.test";
const ADV_ID = "11111111-2222-3333-4444-555555555555";
const TOKEN = "internal-token";

beforeEach(() => {
  kv = memoryKv();
  stats = countingD1();
  pending = [];
  env = {
    SITES: kv,
    PHOTOS: memoryR2(),
    STATS: stats,
    PUBLIC_ORIGIN: ORIGIN,
    SITES_DOMAIN: "3pandasite.test",
    INTERNAL_TOKEN: TOKEN,
    METRICS_TOKEN: "metrics-token",
    BILLING: "off",
    ADMIN_EMAILS: "admin@3pandalabs.test",
  };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

const auth = { authorization: `Bearer ${TOKEN}` };

async function internalCreate(fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  const base = { businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison" };
  for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
  return call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: auth, body: form });
}

async function makeSite(fields: Record<string, string> = {}): Promise<{ slug: string; siteUrl: string }> {
  const res = await internalCreate(fields);
  expect(res.status).toBe(201);
  return (await res.json()) as { slug: string; siteUrl: string };
}

describe("HEAD", () => {
  it("answers a customer site's home like GET, with no body and no redirect loop", async () => {
    const { slug } = await makeSite({ slug: "green-lawns" });
    const ua = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" };
    const get = await call(`https://${slug}.3pandasite.test/`, { headers: ua });
    const writesAfterGet = stats.writes;
    const head = await call(`https://${slug}.3pandasite.test/`, { method: "HEAD", headers: ua });
    expect(get.status).toBe(200);
    expect(head.status).toBe(200);
    expect(head.headers.get("location")).toBeNull();
    expect(head.headers.get("content-type")).toBe(get.headers.get("content-type"));
    expect(head.headers.get("cache-control")).toBe(get.headers.get("cache-control"));
    expect(await head.text()).toBe("");
    // A HEAD is not a visit.
    expect(writesAfterGet).toBe(1);
    expect(stats.writes).toBe(1);
  });

  it("follows the same redirects as GET (other paths, renamed addresses)", async () => {
    await makeSite({ slug: "green-lawns" });
    const other = await call("https://green-lawns.3pandasite.test/about", { method: "HEAD" });
    expect(other.status).toBe(302);
    expect(other.headers.get("location")).toBe("https://green-lawns.3pandasite.test/");
    await kv.put("alias:old-lawns", "green-lawns");
    const renamed = await call("https://old-lawns.3pandasite.test/", { method: "HEAD" });
    expect(renamed.status).toBe(301);
    expect(renamed.headers.get("location")).toBe("https://green-lawns.3pandasite.test/");
  });

  it("refuses other methods on a customer site with 405 instead of redirecting to itself", async () => {
    await makeSite({ slug: "green-lawns" });
    for (const method of ["PUT", "DELETE", "OPTIONS"]) {
      const res = await call("https://green-lawns.3pandasite.test/", { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("works on the main site's pages too (they 404'd before)", async () => {
    for (const path of ["/", "/privacy", "/terms", "/new"]) {
      const res = await call(`${ORIGIN}${path}`, { method: "HEAD" });
      expect(res.status, path).toBe(200);
      expect(await res.text()).toBe("");
    }
  });
});

describe("/done/<handoff> is one-time", () => {
  const handoff = "abcdefghijklmnopqrstuvwx";
  beforeEach(async () => {
    await kv.put(`done:${handoff}`, JSON.stringify({ siteUrl: "https://x.3pandasite.test/", editUrl: `${ORIGIN}/edit/x?k=SECRETKEY` }));
  });

  it("shows the edit link once, then the expired page", async () => {
    const first = await call(`${ORIGIN}/done/${handoff}`);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("SECRETKEY");
    expect(kv.data.has(`done:${handoff}`)).toBe(false);
    const again = await call(`${ORIGIN}/done/${handoff}`);
    expect(again.status).toBe(404);
    expect(await again.text()).not.toContain("SECRETKEY");
  });

  it("a HEAD doesn't use it up", async () => {
    const head = await call(`${ORIGIN}/done/${handoff}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(kv.data.has(`done:${handoff}`)).toBe(true);
    expect((await call(`${ORIGIN}/done/${handoff}`)).status).toBe(200);
  });
});

/** A SiteVault account linked to the AdVault user, owning a SiteVault-built site. */
async function sitevaultBuiltSite(slug = "lawn-pros"): Promise<void> {
  const now = new Date().toISOString();
  await kv.put("acct:a1", JSON.stringify({ id: "a1", email: "owner@example.com", pw: null, advaultUserId: ADV_ID, sites: [slug], createdAt: now }));
  await kv.put("acctemail:owner@example.com", "a1");
  await kv.put(`acctadv:${ADV_ID}`, "a1");
  await kv.put(
    `site:${slug}`,
    JSON.stringify({
      slug,
      businessName: "Lawn Pros",
      category: "landscaping",
      phone: "5552019999",
      city: "Edison",
      photos: [],
      video: null,
      status: "live",
      source: "web",
      ownerId: "a1",
      editKeyHash: "x",
      createdAt: now,
      updatedAt: now,
    }),
  );
}

describe("GET /api/internal/account-site", () => {
  const url = (q: string) => `${ORIGIN}/api/internal/account-site?${q}`;

  it("needs the internal token", async () => {
    expect((await call(url(`advaultUserId=${ADV_ID}`))).status).toBe(401);
  });

  it("404 no_site when the account has no website", async () => {
    const res = await call(url(`advaultUserId=${ADV_ID}`), { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "no_site" });
  });

  it("returns the site the account built on SiteVault", async () => {
    await sitevaultBuiltSite();
    const res = await call(url(`advaultUserId=${ADV_ID}`), { headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, slug: "lawn-pros", siteUrl: "https://lawn-pros.3pandasite.test/", state: "live", source: "web" });
  });

  it("finds an account not yet linked by its email, without linking it", async () => {
    await sitevaultBuiltSite();
    await kv.delete(`acctadv:${ADV_ID}`);
    const other = "99999999-2222-3333-4444-555555555555";
    const res = await call(url(`advaultUserId=${other}&email=Owner@Example.com`), { headers: auth });
    expect(res.status).toBe(200);
    expect(kv.data.has(`acctadv:${other}`)).toBe(false);
  });

  it("follows a rename (account.sites still holds the old slug)", async () => {
    await sitevaultBuiltSite("lawn-pros");
    const site = JSON.parse(kv.data.get("site:lawn-pros")!.value);
    await kv.put("site:lawn-pros-nj", JSON.stringify({ ...site, slug: "lawn-pros-nj" }));
    await kv.delete("site:lawn-pros");
    await kv.put("alias:lawn-pros", "lawn-pros-nj");
    const res = await call(url(`advaultUserId=${ADV_ID}`), { headers: auth });
    expect(await res.json()).toMatchObject({ slug: "lawn-pros-nj", siteUrl: "https://lawn-pros-nj.3pandasite.test/" });
  });
});

describe("internal create: one website per account", () => {
  const owner = { ownerAdvaultUserId: ADV_ID, ownerEmail: "owner@example.com" };

  it("409 account_has_site when the account already built one on SiteVault (even with the same phone)", async () => {
    await sitevaultBuiltSite();
    const res = await internalCreate({ ...owner, phone: "555-201-9999" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "account_has_site", slug: "lawn-pros", siteUrl: "https://lawn-pros.3pandasite.test/" });
  });

  it("409 with a different phone too: no second site", async () => {
    await sitevaultBuiltSite();
    const res = await internalCreate({ ...owner, phone: "555-201-1234" });
    expect(res.status).toBe(409);
    expect([...kv.data.keys()].filter((k) => k.startsWith("site:"))).toEqual(["site:lawn-pros"]);
  });

  it("admins are exempt", async () => {
    await sitevaultBuiltSite();
    const res = await internalCreate({ ...owner, phone: "555-201-1234", ownerAdmin: "1" });
    expect(res.status).toBe(201);
  });

  it("a first site for the account is made as before", async () => {
    const res = await internalCreate(owner);
    expect(res.status).toBe(201);
  });
});

describe("/metrics", () => {
  it("reports uptimeSeconds null (a Worker has no process start)", async () => {
    const res = await call(`${ORIGIN}/metrics`, { headers: { authorization: "Bearer metrics-token" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.app).toBe("sitevault");
    expect(body.uptimeSeconds).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Before & after pairs (optional; AdVault's internal create + the edit page)

const jpeg = (name: string, bytes = 10, type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });
const R2 = () => env.PHOTOS as ReturnType<typeof memoryR2>;
type Pair = { before: string; after: string };

async function internalCreateWith(fields: Record<string, string>, files: Record<string, File>): Promise<Response> {
  const form = new FormData();
  const base = { businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison" };
  for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
  for (const [k, f] of Object.entries(files)) form.set(k, f);
  return call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: auth, body: form });
}

const twoPairs = () => ({ ba1Before: jpeg("1b.jpg"), ba1After: jpeg("1a.jpg"), ba2Before: jpeg("2b.jpg"), ba2After: jpeg("2a.jpg") });
const stored = (slug: string) =>
  JSON.parse(kv.data.get(`site:${slug}`)!.value) as { beforeAfter?: Pair[]; photos: string[]; status: string; category: string };

describe("internal create: before & after pairs", () => {
  it("stores complete pairs as R2 keys under the site's folder", async () => {
    const res = await internalCreateWith({}, twoPairs());
    expect(res.status).toBe(201);
    const { slug } = (await res.json()) as { slug: string };
    const pairs = stored(slug).beforeAfter!;
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.before.startsWith(`sites/${slug}/`) && p.after.startsWith(`sites/${slug}/`)).toBe(true);
      expect(R2().data.has(p.before) && R2().data.has(p.after)).toBe(true);
    }
  });

  it("no before & after fields: made exactly as before, no beforeAfter on the record", async () => {
    const { slug } = await makeSite();
    expect(stored(slug).beforeAfter).toBeUndefined();
    expect(R2().data.size).toBe(0);
  });

  it("half a pair is a 400 with errors.beforeAfter, and nothing is stored", async () => {
    const res = await internalCreateWith({}, { ba1Before: jpeg("1b.jpg"), ba2Before: jpeg("2b.jpg"), ba2After: jpeg("2a.jpg") });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Record<string, string> };
    expect(body.errors.beforeAfter).toMatch(/both a before and an after/);
    expect([...kv.data.keys()].some((k) => k.startsWith("site:"))).toBe(false);
    expect(R2().data.size).toBe(0);
  });

  it("rejects a non-image type, HEIC (AdVault sends web images only) and over 8 MB", async () => {
    for (const bad of [jpeg("x.gif", 10, "image/gif"), jpeg("x.heic", 10, "image/heic"), jpeg("big.jpg", 8 * 1024 * 1024 + 1)]) {
      const res = await internalCreateWith({}, { ba1Before: bad, ba1After: jpeg("1a.jpg") });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { errors: Record<string, string> }).errors.beforeAfter).toBeTruthy();
    }
  });

  it("the customer host serves the pair photos, and only this site's", async () => {
    const res = await internalCreateWith({}, { ba1Before: jpeg("1b.jpg"), ba1After: jpeg("1a.jpg") });
    const { slug } = (await res.json()) as { slug: string };
    const [p] = stored(slug).beforeAfter!;
    const host = `https://${slug}.3pandasite.test`;
    const page = await (await call(`${host}/`)).text();
    expect(page).toContain("Before &amp; after");
    expect(page).toContain(`/p/${p!.before}`);
    expect((await call(`${host}/p/${p!.before}`)).status).toBe(200);
    expect((await call(`${host}/p/${p!.after}`, { method: "HEAD" })).status).toBe(200);
    const other = (await (await internalCreateWith({ businessName: "Other Co", phone: "555-201-7777" }, {})).json()) as { slug: string };
    expect((await call(`https://${other.slug}.3pandasite.test/p/${p!.before}`)).status).toBe(404);
  });

  it("removal deletes the pair photos and clears them from the record", async () => {
    const res = await internalCreateWith({}, twoPairs());
    const { slug } = (await res.json()) as { slug: string };
    expect(R2().data.size).toBe(4);
    env.ADMIN_TOKEN = "admin-token";
    const rm = await call(`${ORIGIN}/api/admin/sites/${slug}/remove`, { method: "POST", headers: { authorization: "Bearer admin-token" } });
    expect(rm.status).toBeLessThan(400);
    expect(R2().data.size).toBe(0);
    expect(stored(slug).status).toBe("removed");
    expect(stored(slug).beforeAfter).toBeUndefined();
  });
});

describe("edit page: before & after", () => {
  async function made(fields: Record<string, string> = {}, files: Record<string, File> = {}) {
    const res = await internalCreateWith(fields, files);
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string | string[]>, files: Record<string, File> = {}) {
    const form = new FormData();
    const base = { businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) for (const x of Array.isArray(v) ? v : [v]) form.append(k, x);
    for (const [k, f] of Object.entries(files)) form.set(k, f);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", headers: { accept: "application/json" }, body: form });
  }
  const errs = async (r: Response) => ((await r.json()) as { errors: Record<string, string> }).errors;

  it("shows current pairs with keep boxes, and add slots + the tick for an allowed trade", async () => {
    const { slug, key } = await made({}, { ba1Before: jpeg("1b.jpg"), ba1After: jpeg("1a.jpg") });
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    const [p] = stored(slug).beforeAfter!;
    expect(page).toContain(`name="keepPair" value="${p!.before}"`);
    expect(page).toContain('name="ba1Before"');
    expect(page).not.toContain('name="ba2Before"'); // one pair left of the two
    expect(page).toContain("These are real photos of our own work.");
  });

  it("no before & after fieldset for a trade where it does not fit", async () => {
    const { slug, key } = await made({ category: "salon" });
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).not.toContain('name="ba1Before"');
    expect(page).not.toContain("<legend>Before &amp; after</legend>");
  });

  it("unticking a pair removes it and deletes its photos; kept pairs stay", async () => {
    const { slug, key } = await made({}, twoPairs());
    const [p1, p2] = stored(slug).beforeAfter!;
    const res = await save(slug, key, { keepPair: [p2!.before] });
    expect(res.status).toBe(200);
    expect(stored(slug).beforeAfter).toEqual([p2]);
    expect(R2().data.has(p1!.before) || R2().data.has(p1!.after)).toBe(false);
    expect(R2().data.has(p2!.before)).toBe(true);
    // Untick all: the section goes away.
    await save(slug, key, {});
    expect(stored(slug).beforeAfter).toBeUndefined();
    expect(R2().data.size).toBe(0);
  });

  it("adds a pair with both photos and the tick", async () => {
    const { slug, key } = await made();
    const res = await save(slug, key, { baAttest: "yes" }, { ba1Before: jpeg("b.jpg"), ba1After: jpeg("a.jpg") });
    expect(res.status).toBe(200);
    expect(stored(slug).beforeAfter).toHaveLength(1);
  });

  it("refuses an added pair without the tick, half a pair, a third pair, or a non-allowed trade", async () => {
    const { slug, key } = await made({}, twoPairs());
    const keepBoth = stored(slug).beforeAfter!.map((p) => p.before);
    const pair = () => ({ ba1Before: jpeg("b.jpg"), ba1After: jpeg("a.jpg") });
    const noTick = await save(slug, key, { keepPair: keepBoth.slice(0, 1) }, pair());
    expect(noTick.status).toBe(400);
    expect((await errs(noTick)).baAttest).toBeTruthy();
    const half = await save(slug, key, { keepPair: keepBoth.slice(0, 1), baAttest: "yes" }, { ba1Before: jpeg("b.jpg") });
    expect((await errs(half)).beforeAfter).toMatch(/both a before and an after/);
    const third = await save(slug, key, { keepPair: keepBoth, baAttest: "yes" }, pair());
    expect((await errs(third)).beforeAfter).toMatch(/Up to 2/);
    const salon = await save(slug, key, { category: "salon", keepPair: [], baAttest: "yes" }, pair());
    expect((await errs(salon)).beforeAfter).toMatch(/not available/);
    expect(stored(slug).beforeAfter).toHaveLength(2);
    expect(R2().data.size).toBe(4);
  });

  it("a rename keeps the pairs served from the new address", async () => {
    const { slug, key } = await made({}, { ba1Before: jpeg("1b.jpg"), ba1After: jpeg("1a.jpg") });
    const [p] = stored(slug).beforeAfter!;
    const res = await save(slug, key, { slug: "green-lawns-new", keepPair: [p!.before] });
    expect(res.status).toBe(200);
    expect(stored("green-lawns-new").beforeAfter).toEqual([p]);
    expect((await call(`https://green-lawns-new.3pandasite.test/p/${p!.before}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// AdVault admin "Delete it and make a new one" (2026-11-17)

describe("DELETE /api/internal/sites/<slug>", () => {
  const owner = { ownerAdvaultUserId: ADV_ID, ownerEmail: "owner@example.com" };
  const del = (slug: string, q = `advaultUserId=${ADV_ID}&email=owner@example.com`, headers: Record<string, string> = auth) =>
    call(`${ORIGIN}/api/internal/sites/${slug}?${q}`, { method: "DELETE", headers });

  it("needs the internal token and an AdVault user id", async () => {
    const { slug } = await makeSite(owner);
    expect((await del(slug, `advaultUserId=${ADV_ID}`, {})).status).toBe(401);
    expect((await del(slug, "advaultUserId=x")).status).toBe(400);
    expect(kv.data.has(`site:${slug}`)).toBe(true);
  });

  it("deletes the site, its photos, before & after and video, and frees the address, phone, aliases and account slot", async () => {
    const form = { ...owner, slug: "green-lawns" };
    const res = await internalCreateWith(form, { photos: jpeg("p.jpg"), ...twoPairs() });
    expect(res.status).toBe(201);
    const video = new FormData();
    video.set("video", new File([new Uint8Array(10)], "ad.mp4", { type: "video/mp4" }));
    expect((await call(`${ORIGIN}/api/internal/sites/green-lawns/video`, { method: "POST", headers: auth, body: video })).status).toBe(200);
    expect(R2().data.size).toBe(6);
    // An old address (rename) points here too.
    await kv.put("alias:old-lawns", "green-lawns");
    const site = JSON.parse(kv.data.get("site:green-lawns")!.value);
    await kv.put("site:green-lawns", JSON.stringify({ ...site, aliases: ["old-lawns"] }));

    const gone = await del("old-lawns");
    expect(gone.status).toBe(200);
    expect(await gone.json()).toMatchObject({ ok: true, slug: "green-lawns", deleted: true });
    expect(R2().data.size).toBe(0);
    for (const k of ["site:green-lawns", "alias:old-lawns", "phone:5552010000"]) expect(kv.data.has(k)).toBe(false);
    expect([...kv.data.keys()].some((k) => k.startsWith("nt:"))).toBe(false);
    const acct = JSON.parse(kv.data.get(`acct:${kv.data.get(`acctadv:${ADV_ID}`)!.value}`)!.value) as { sites: string[] };
    expect(acct.sites).toEqual([]);
    expect((await call(`https://green-lawns.3pandasite.test/`)).status).toBe(404);

    // A new site for the same account, phone and address is made as new.
    const again = await internalCreate(form);
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ slug: "green-lawns" });
  });

  it("is idempotent: an unknown or already-deleted address is ok, deleted false", async () => {
    const { slug } = await makeSite(owner);
    expect((await del(slug)).status).toBe(200);
    const twice = await del(slug);
    expect(twice.status).toBe(200);
    expect(await twice.json()).toMatchObject({ ok: true, deleted: false });
  });

  it("deletes a site the account built on SiteVault itself", async () => {
    await sitevaultBuiltSite();
    expect(await (await del("lawn-pros")).json()).toMatchObject({ deleted: true });
    expect(kv.data.has("site:lawn-pros")).toBe(false);
  });

  it("refuses another account's site (403) and leaves it alone", async () => {
    await sitevaultBuiltSite();
    const other = "99999999-2222-3333-4444-555555555555";
    const res = await del("lawn-pros", `advaultUserId=${other}&email=someone@example.com`);
    expect(res.status).toBe(403);
    expect(kv.data.has("site:lawn-pros")).toBe(true);
  });

  it("refuses a site with a renewing SiteVault subscription (409 has_subscription)", async () => {
    await sitevaultBuiltSite();
    const site = JSON.parse(kv.data.get("site:lawn-pros")!.value);
    await kv.put("site:lawn-pros", JSON.stringify({ ...site, billing: { status: "active", plan: "pro", buildPaid: true, paidUntil: null, renewing: true, credits: 2, subscriptionId: "sub_1" } }));
    const res = await del("lawn-pros");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "has_subscription" });
  });

  it("leaves an ops takedown record (status removed) in place", async () => {
    const { slug } = await makeSite(owner);
    env.ADMIN_TOKEN = "admin-token";
    await call(`${ORIGIN}/api/admin/sites/${slug}/remove`, { method: "POST", headers: { authorization: "Bearer admin-token" } });
    expect(await (await del(slug)).json()).toMatchObject({ ok: true, deleted: false, removed: true });
    expect(kv.data.has(`site:${slug}`)).toBe(true);
  });
});

describe("password reset pages", () => {
  const originH = { origin: ORIGIN };
  const formPost = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
    call(`${ORIGIN}${path}`, { method: "POST", headers, body: new URLSearchParams(fields) });

  it("GET /forgot-password renders the email form", async () => {
    const res = await call(`${ORIGIN}/forgot-password`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Reset your password");
  });

  it("POST /forgot-password always confirms (enumeration-safe) and requires same-origin", async () => {
    expect((await formPost("/forgot-password", { email: "whoever@x.test" })).status).toBe(403); // no Origin header
    const ok = await formPost("/forgot-password", { email: "whoever@x.test" }, originH);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Check your email");
  });

  it("GET /reset-password shows the form with a token, or 'invalid' without one", async () => {
    expect(await (await call(`${ORIGIN}/reset-password?token=abc.def`)).text()).toContain('name="token" value="abc.def"');
    expect(await (await call(`${ORIGIN}/reset-password`)).text()).toContain("missing or invalid");
  });

  it("POST /reset-password needs a token and a valid password", async () => {
    // valid-looking password but AdVault is unconfigured here, so the token can't verify
    const bad = await formPost("/reset-password", { token: "abc.def", password: "a brand new password" }, originH);
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("invalid or has expired");
    // too-short password is rejected before any call
    expect((await formPost("/reset-password", { token: "abc.def", password: "short" }, originH)).status).toBe(400);
  });

  it("GET /login?reset=1 shows the password-changed notice", async () => {
    expect(await (await call(`${ORIGIN}/login?reset=1`)).text()).toContain("password has been changed");
  });

  it("POST /account/change-password with no session redirects to sign in", async () => {
    const res = await formPost("/account/change-password", { currentPassword: "x", newPassword: "a new password" }, originH);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login`);
  });
});

describe("customer reviews", () => {
  async function makeWithKey(fields: Record<string, string> = {}) {
    const res = await internalCreate(fields);
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  const review = (slug: string, body: Record<string, string>) =>
    call(`https://${slug}.3pandasite.test/review`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  const pendingKeys = (slug: string) => [...kv.data.keys()].filter((k) => k.startsWith(`revq:${slug}:`));
  const reviewsOf = (slug: string) => (stored(slug) as unknown as { reviews?: { text: string }[] }).reviews ?? [];

  it("stores a submission as pending; honeypot and invalid are dropped", async () => {
    const { slug } = await makeWithKey({ slug: "rev-site" });
    expect((await review(slug, { name: "Pat", rating: "5", text: "Great job" })).status).toBe(200);
    expect(pendingKeys(slug)).toHaveLength(1);
    await review(slug, { name: "Bot", rating: "5", text: "spam", website: "http://x" }); // honeypot
    expect(pendingKeys(slug)).toHaveLength(1);
    expect((await review(slug, { name: "Pat", rating: "9", text: "x" })).status).toBe(400); // bad rating
    expect(pendingKeys(slug)).toHaveLength(1);
  });

  it("rate-limits a visitor after 3 a day", async () => {
    const { slug } = await makeWithKey({ slug: "rl-site" });
    for (let i = 0; i < 3; i++) await review(slug, { name: "Pat", rating: "5", text: `review ${i}` });
    expect(pendingKeys(slug)).toHaveLength(3);
    await review(slug, { name: "Pat", rating: "5", text: "one more" });
    expect(pendingKeys(slug)).toHaveLength(3); // dropped
  });

  it("owner approve publishes it (and it shows on the live site); reject and remove work", async () => {
    const { slug, key } = await makeWithKey({ slug: "mod-site" });
    await review(slug, { name: "Pat", rating: "4", text: "Solid work" });
    const moderate = (action: string, reviewId: string) =>
      call(`${ORIGIN}/api/sites/${slug}/reviews`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key, action, reviewId }),
      });
    const id = pendingKeys(slug)[0]!.split(":").pop()!;
    expect((await moderate("approve", id)).status).toBe(303);
    expect(pendingKeys(slug)).toHaveLength(0);
    expect(reviewsOf(slug).map((r) => r.text)).toEqual(["Solid work"]);
    expect(await (await call(`https://${slug}.3pandasite.test/`)).text()).toContain("Solid work");
    await moderate("remove", id);
    expect(reviewsOf(slug)).toHaveLength(0);
    await review(slug, { name: "X", rating: "2", text: "meh" });
    const id2 = pendingKeys(slug)[0]!.split(":").pop()!;
    await moderate("reject", id2);
    expect(pendingKeys(slug)).toHaveLength(0);
  });
});

describe("customer-site policy pages", () => {
  async function made(fields: Record<string, string> = {}) {
    const res = await internalCreate({ email: "hi@greenlawns.test", address: "12 Oak St", ...fields });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string>) {
    const form = new FormData();
    const base = { businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison", email: "hi@greenlawns.test", address: "12 Oak St", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }
  const policies = (slug: string) => (JSON.parse(kv.data.get(`site:${slug}`)!.value) as { policies?: Record<string, string> }).policies;

  it("serves all four pages, prepopulated from the business and accurate about cookies", async () => {
    const { slug } = await made();
    const host = `https://${slug}.3pandasite.test`;
    for (const [path, title] of [["/privacy", "Privacy Policy"], ["/accessibility", "Accessibility Statement"], ["/cookies", "Cookies Policy"], ["/terms", "Terms of Service"]]) {
      const res = await call(`${host}${path}`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain(`<h1>${title}</h1>`);
      expect(body).toContain("Green Lawns");
    }
    const cookies = await (await call(`${host}/cookies`)).text();
    expect(cookies).toMatch(/does not set cookies/i);
    expect(cookies).not.toMatch(/advertising cookies/i);
  });

  it("links the four pages in the site footer", async () => {
    const { slug } = await made();
    const home = await (await call(`https://${slug}.3pandasite.test/`)).text();
    for (const p of ["/privacy", "/accessibility", "/cookies", "/terms"]) expect(home).toContain(`href="${p}"`);
  });

  it("HEAD works and a bad method is 405, like the rest of the customer host", async () => {
    const { slug } = await made();
    const host = `https://${slug}.3pandasite.test`;
    expect((await call(`${host}/privacy`, { method: "HEAD" })).status).toBe(200);
    expect((await call(`${host}/privacy`, { method: "POST" })).status).toBe(405);
  });

  it("does not let the owner edit the policy pages (no editable fields, nothing stored)", async () => {
    const { slug, key } = await made();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    for (const k of ["privacy", "accessibility", "cookies", "terms"]) expect(page).not.toContain(`name="policy_${k}"`);
    expect(page).not.toContain("Legal &amp; policy pages");
    // Even a hand-crafted policy_* field in the form is ignored — nothing is stored.
    const res = await save(slug, key, { policy_privacy: "## Mine\nCustom text." });
    expect(res.status).toBe(303);
    expect(policies(slug)).toBeUndefined();
    const privacy = await (await call(`https://${slug}.3pandasite.test/privacy`)).text();
    expect(privacy).not.toContain("Custom text.");
    expect(privacy).toContain("Anonymous visit counts");
  });

  it("a policy page reflects the business's current details", async () => {
    const { slug, key } = await made();
    await save(slug, key, { phone: "(555) 999-1234" });
    const privacy = await (await call(`https://${slug}.3pandasite.test/privacy`)).text();
    expect(privacy).toContain("(555) 999-1234");
  });
});

describe("contact page", () => {
  it("serves /contact with the email, and the footer links to it (not a bare mailto)", async () => {
    const res = await call(`${ORIGIN}/contact`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("3pandas@3pandalabs.com");
    expect(body).toContain("Contact us");
    // Footer link points at the page now.
    const home = await (await call(`${ORIGIN}/`)).text();
    expect(home).toContain('href="/contact"');
    expect(home).not.toContain('href="mailto:3pandas@3pandalabs.com">Contact');
  });
});

describe("restaurant/bakery menu upload", () => {
  async function made(fields: Record<string, string> = {}) {
    const res = await internalCreate({ category: "restaurant", businessName: "Tony's Pizza", phone: "(555) 300-1000", ...fields });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string | string[]> = {}, files: Record<string, File> = {}) {
    const form = new FormData();
    const base = { businessName: "Tony's Pizza", category: "restaurant", phone: "(555) 300-1000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) for (const x of Array.isArray(v) ? v : [v]) form.append(k, x);
    for (const [k, f] of Object.entries(files)) form.append(k, f);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }
  const menuOf = (slug: string) => (JSON.parse(kv.data.get(`site:${slug}`)!.value) as { menu?: string[] }).menu;
  const pdf = (name = "menu.pdf", bytes = 10) => jpeg(name, bytes, "application/pdf");

  it("shows the Menu fieldset on the edit page for a restaurant, hidden for a landscaper", async () => {
    const r = await made();
    const rest = await (await call(`${ORIGIN}/edit/${r.slug}?k=${r.key}`)).text();
    expect(rest).toContain("Add menu files");
    // Restaurant: the fieldset is visible (not hidden).
    expect(rest).not.toMatch(/<fieldset id="menu-fieldset"[^>]*\shidden/);
    const lawn = await internalCreate({ slug: "lawns-x", businessName: "Lawns X", phone: "(555) 300-2000" });
    const { slug, editUrl } = (await lawn.json()) as { slug: string; editUrl: string };
    const key = new URL(editUrl).searchParams.get("k")!;
    // Landscaper: present but hidden, so a non-food business never sees it.
    expect(await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text()).toMatch(/<fieldset id="menu-fieldset"[^>]*\shidden/);
  });

  it("stores an uploaded PDF menu and shows a small PDF tile linking to it", async () => {
    const { slug, key } = await made();
    expect((await save(slug, key, {}, { menu: pdf() })).status).toBe(303);
    const keys = menuOf(slug)!;
    expect(keys).toHaveLength(1);
    expect(keys[0]!.endsWith(".pdf")).toBe(true);
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain("menu-pdf-tile");
    expect(page).toContain("View menu");
    expect(page).toContain(`/p/${keys[0]}`);
    const file = await call(`https://${slug}.3pandasite.test/p/${keys[0]}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
  });

  it("shows an uploaded image menu as a gallery thumbnail (enlarges on tap)", async () => {
    const { slug, key } = await made();
    expect((await save(slug, key, {}, { menu: jpeg("menu.jpg") })).status).toBe(303);
    const keys = menuOf(slug)!;
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain('id="menu-h"');
    // Rendered inside the gallery grid, so the existing lightbox enlarges it on tap.
    expect(page).toContain('class="gallery menu-grid"');
    expect(page).toContain(`<img src="https://${slug}.3pandasite.test/p/${keys[0]}"`);
  });

  it("allows up to 6 menu files", async () => {
    const { slug, key } = await made();
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Tony's Pizza", category: "restaurant", phone: "(555) 300-1000", city: "Edison", key })) form.append(k, v);
    for (let i = 0; i < 6; i++) form.append("menu", jpeg(`m${i}.jpg`));
    expect((await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form })).status).toBe(303);
    expect(menuOf(slug)).toHaveLength(6);
    // A 7th is over the cap.
    const over = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Tony's Pizza", category: "restaurant", phone: "(555) 300-1000", city: "Edison", key })) over.append(k, v);
    for (const existing of menuOf(slug)!) over.append("keepMenu", existing);
    over.append("menu", jpeg("extra.jpg"));
    const res = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", headers: { accept: "application/json" }, body: over });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.menu).toMatch(/Up to 6/);
  });

  it("rejects a menu for a business type where it doesn't belong", async () => {
    const lawn = await internalCreate({ slug: "lawns-y", businessName: "Lawns Y", phone: "(555) 300-3000" });
    const { slug, editUrl } = (await lawn.json()) as { slug: string; editUrl: string };
    const key = new URL(editUrl).searchParams.get("k")!;
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Lawns Y", category: "landscaping", phone: "(555) 300-3000", city: "Edison", key })) form.append(k, v);
    form.append("menu", pdf());
    const res = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", headers: { accept: "application/json" }, body: form });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.menu).toBeTruthy();
    expect(menuOf(slug)).toBeUndefined();
  });

  it("rejects a disallowed type and an oversized file", async () => {
    const { slug, key } = await made();
    for (const bad of [jpeg("m.gif", 10, "image/gif"), pdf("big.pdf", 10 * 1024 * 1024 + 1)]) {
      const res = await call(`${ORIGIN}/api/sites/${slug}`, {
        method: "POST",
        headers: { accept: "application/json" },
        body: (() => {
          const f = new FormData();
          for (const [k, v] of Object.entries({ businessName: "Tony's Pizza", category: "restaurant", phone: "(555) 300-1000", city: "Edison", key })) f.append(k, v);
          f.append("menu", bad);
          return f;
        })(),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { errors: Record<string, string> }).errors.menu).toBeTruthy();
    }
  });

  it("removes a menu file when unticked, and deletes it from R2", async () => {
    const { slug, key } = await made();
    await save(slug, key, {}, { menu: pdf() });
    const k0 = menuOf(slug)![0]!;
    expect(R2().data.has(k0)).toBe(true);
    // Save again without keepMenu for that key -> removed.
    expect((await save(slug, key)).status).toBe(303);
    expect(menuOf(slug)).toBeUndefined();
    expect(R2().data.has(k0)).toBe(false);
  });
});

describe("menu in the builder (create flow)", () => {
  it("renders the Menu fieldset on the builder, hidden until a food category is picked", async () => {
    const page = await (await call(`${ORIGIN}/new`)).text();
    expect(page).toContain('id="menu-fieldset"');
    expect(page).toContain('data-show-cats="restaurant,bakery"');
    // No category chosen yet on a fresh builder -> starts hidden (JS reveals it).
    expect(page).toMatch(/<fieldset id="menu-fieldset"[^>]*\shidden/);
  });

  async function publicCreate(fields: Record<string, string>, files: Record<string, File> = {}) {
    const form = new FormData();
    const base = {
      businessName: "Tony's Pizza",
      category: "restaurant",
      phone: "(555) 400-1000",
      city: "Edison",
      attest: "yes",
      acct_email: "owner-menu@example.test",
      acct_password: "supersecret1",
    };
    for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
    for (const [k, f] of Object.entries(files)) form.set(k, f);
    return call(`${ORIGIN}/api/sites`, { method: "POST", headers: { accept: "application/json" }, body: form });
  }
  const storedBySlug = (slug: string) => JSON.parse(kv.data.get(`site:${slug}`)!.value) as { menu?: string[]; category: string };
  const onlySlug = () => [...kv.data.keys()].find((k) => k.startsWith("site:"))!.slice("site:".length);

  it("stores a menu uploaded while building a restaurant site", async () => {
    const res = await publicCreate({}, { menu: jpeg("menu.pdf", 10, "application/pdf") });
    expect(res.status).toBe(200);
    const slug = onlySlug();
    const menu = storedBySlug(slug).menu!;
    expect(menu).toHaveLength(1);
    expect(menu[0]!.endsWith(".pdf")).toBe(true);
    expect(await (await call(`https://${slug}.3pandasite.test/`)).text()).toContain("menu-pdf-tile");
  });

  it("rejects a menu at build time for a non-food business", async () => {
    const res = await publicCreate({ category: "plumbing", businessName: "Pipe Co" }, { menu: jpeg("menu.pdf", 10, "application/pdf") });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.menu).toBeTruthy();
    expect([...kv.data.keys()].some((k) => k.startsWith("site:"))).toBe(false);
  });
});

describe("menu upload endpoint (Upload button)", () => {
  async function made(fields: Record<string, string> = {}) {
    const res = await internalCreate({ category: "restaurant", businessName: "Tony's Pizza", phone: "(555) 500-1000", ...fields });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function upload(slug: string, key: string | null, files: File[]) {
    const form = new FormData();
    if (key !== null) form.set("key", key);
    for (const f of files) form.append("menu", f);
    return call(`${ORIGIN}/api/sites/${slug}/menu`, { method: "POST", headers: { accept: "application/json" }, body: form });
  }
  const menuOf = (slug: string) => (JSON.parse(kv.data.get(`site:${slug}`)!.value) as { menu?: string[] }).menu;
  const pdf = (name = "menu.pdf", bytes = 10) => jpeg(name, bytes, "application/pdf");

  it("renders an Upload menu button on a restaurant's edit page", async () => {
    const { slug, key } = await made();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).toContain('id="menu-upload-btn"');
    expect(page).toContain('id="menu-current"');
  });

  it("uploads a file on its own and returns the updated menu list", async () => {
    const { slug, key } = await made();
    const res = await upload(slug, key, [pdf()]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; menu: { key: string; url: string; pdf: boolean }[] };
    expect(body.ok).toBe(true);
    expect(body.menu).toHaveLength(1);
    expect(body.menu[0]!.pdf).toBe(true);
    expect(body.menu[0]!.url).toContain(`/p/${menuOf(slug)![0]}`);
    // Persisted without any full-form save.
    expect(menuOf(slug)).toHaveLength(1);
  });

  it("appends to the existing menu", async () => {
    const { slug, key } = await made();
    await upload(slug, key, [jpeg("a.jpg")]);
    await upload(slug, key, [jpeg("b.jpg")]);
    expect(menuOf(slug)).toHaveLength(2);
  });

  it("rejects a bad key, a non-food site, and going over the cap", async () => {
    const { slug, key } = await made();
    expect((await upload(slug, "WRONGKEY", [pdf()])).status).toBe(403);
    expect(menuOf(slug)).toBeUndefined();

    const lawn = await internalCreate({ slug: "lawns-up", businessName: "Lawns Up", phone: "(555) 500-2000" });
    const l = (await lawn.json()) as { slug: string; editUrl: string };
    const lkey = new URL(l.editUrl).searchParams.get("k")!;
    const bad = await upload(l.slug, lkey, [pdf()]);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/can't be added/);

    for (let i = 0; i < 6; i++) await upload(slug, key, [jpeg(`m${i}.jpg`)]);
    expect(menuOf(slug)).toHaveLength(6);
    const over = await upload(slug, key, [jpeg("x.jpg")]);
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: string }).error).toMatch(/Up to 6/);
  });
});

describe("fitness class schedule", () => {
  async function fitnessSite() {
    const res = await internalCreate({ category: "fitness", businessName: "Flow Yoga", phone: "(555) 600-1000" });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string> = {}, files: Record<string, File> = {}) {
    const form = new FormData();
    const base = { businessName: "Flow Yoga", category: "fitness", phone: "(555) 600-1000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
    for (const [k, f] of Object.entries(files)) form.set(k, f);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }
  const schedOf = (slug: string) => (JSON.parse(kv.data.get(`site:${slug}`)!.value) as { schedule?: string }).schedule;
  const pdf = (name = "sched.pdf", bytes = 10) => jpeg(name, bytes, "application/pdf");

  it("shows the Class schedule fieldset only for fitness (gated + revealed by category)", async () => {
    const { slug, key } = await fitnessSite();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).toContain('id="schedule-fieldset"');
    expect(page).toContain('data-show-cats="fitness"');
    expect(page).not.toMatch(/<fieldset id="schedule-fieldset"[^>]*\shidden/);
    // Not shown for a landscaper (present but hidden).
    const lawn = await internalCreate({ slug: "lawns-sch", businessName: "Lawns S", phone: "(555) 600-2000" });
    const l = (await lawn.json()) as { slug: string; editUrl: string };
    const lkey = new URL(l.editUrl).searchParams.get("k")!;
    expect(await (await call(`${ORIGIN}/edit/${l.slug}?k=${lkey}`)).text()).toMatch(/<fieldset id="schedule-fieldset"[^>]*\shidden/);
  });

  it("stores an uploaded schedule and shows it in a Class schedule section", async () => {
    const { slug, key } = await fitnessSite();
    expect((await save(slug, key, {}, { schedule: jpeg("week.jpg") })).status).toBe(303);
    const k0 = schedOf(slug)!;
    expect(k0).toBeTruthy();
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain('id="sch-h"');
    expect(page).toContain(`<img src="https://${slug}.3pandasite.test/p/${k0}"`);
  });

  it("a PDF schedule shows as a tile; replacing swaps the file and removing deletes it", async () => {
    const { slug, key } = await fitnessSite();
    await save(slug, key, {}, { schedule: pdf() });
    const first = schedOf(slug)!;
    expect(first.endsWith(".pdf")).toBe(true);
    expect((await (await call(`https://${slug}.3pandasite.test/`)).text())).toContain("View schedule");
    // Replace with a new file.
    await save(slug, key, {}, { schedule: jpeg("new.jpg") });
    const second = schedOf(slug)!;
    expect(second).not.toBe(first);
    expect(R2().data.has(first)).toBe(false);
    // Remove: no new file and keepSchedule not ticked.
    expect((await save(slug, key)).status).toBe(303);
    expect(schedOf(slug)).toBeUndefined();
    expect(R2().data.has(second)).toBe(false);
  });

  it("rejects a schedule for a non-fitness business", async () => {
    const lawn = await internalCreate({ slug: "lawns-sch2", businessName: "Lawns S2", phone: "(555) 600-3000" });
    const l = (await lawn.json()) as { slug: string; editUrl: string };
    const key = new URL(l.editUrl).searchParams.get("k")!;
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Lawns S2", category: "landscaping", phone: "(555) 600-3000", city: "Edison", key })) form.append(k, v);
    form.append("schedule", pdf());
    const res = await call(`${ORIGIN}/api/sites/${l.slug}`, { method: "POST", headers: { accept: "application/json" }, body: form });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.schedule).toBeTruthy();
    expect(schedOf(l.slug)).toBeUndefined();
  });
});

describe("insurance accepted (dentist/clinic)", () => {
  async function dentist() {
    const res = await internalCreate({ category: "dentist", businessName: "Bright Smiles", phone: "(555) 700-1000" });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string>) {
    const form = new FormData();
    const base = { businessName: "Bright Smiles", category: "dentist", phone: "(555) 700-1000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }

  it("shows the Insurance fieldset for a dentist (gated), hidden for a landscaper", async () => {
    const { slug, key } = await dentist();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).toContain('id="insurance-fieldset"');
    expect(page).toContain('data-show-cats="dentist,clinic"');
    expect(page).not.toMatch(/<fieldset id="insurance-fieldset"[^>]*\shidden/);
    const lawn = await internalCreate({ slug: "lawns-ins", businessName: "Lawns I", phone: "(555) 700-2000" });
    const l = (await lawn.json()) as { slug: string; editUrl: string };
    const lkey = new URL(l.editUrl).searchParams.get("k")!;
    expect(await (await call(`${ORIGIN}/edit/${l.slug}?k=${lkey}`)).text()).toMatch(/<fieldset id="insurance-fieldset"[^>]*\shidden/);
  });

  it("renders the accepted plans on the site", async () => {
    const { slug, key } = await dentist();
    expect((await save(slug, key, { insurance: "Delta Dental\nCigna\nAetna" })).status).toBe(303);
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain('id="ins-h"');
    expect(page).toContain("Delta Dental");
    expect(page).toContain("Cigna");
    expect(page).toContain("Aetna");
  });

  it("does not render the section for a non-medical business even if the field is sent", async () => {
    const lawn = await internalCreate({ slug: "lawns-ins2", businessName: "Lawns I2", phone: "(555) 700-3000" });
    const l = (await lawn.json()) as { slug: string; editUrl: string };
    const key = new URL(l.editUrl).searchParams.get("k")!;
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Lawns I2", category: "landscaping", phone: "(555) 700-3000", city: "Edison", key, insurance: "Delta Dental" })) form.set(k, v);
    expect((await call(`${ORIGIN}/api/sites/${l.slug}`, { method: "POST", body: form })).status).toBe(303);
    const page = await (await call(`https://${l.slug}.3pandasite.test/`)).text();
    expect(page).not.toContain('id="ins-h"');
  });
});

describe("meet the team", () => {
  async function salon() {
    const res = await internalCreate({ category: "salon", businessName: "Shear Bliss", phone: "(555) 800-1000" });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string>) {
    const form = new FormData();
    const base = { businessName: "Shear Bliss", category: "salon", phone: "(555) 800-1000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }

  it("shows the team fieldset for a salon (gated), hidden for a plumber", async () => {
    const { slug, key } = await salon();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).toContain('id="team-fieldset"');
    expect(page).toContain("salon,barber,spa,dentist,clinic,fitness,realestate,petcare");
    expect(page).not.toMatch(/<fieldset id="team-fieldset"[^>]*\shidden/);
    const plumb = await internalCreate({ slug: "pipe-team", category: "plumbing", businessName: "Pipe Co", phone: "(555) 800-2000" });
    const p = (await plumb.json()) as { slug: string; editUrl: string };
    const pkey = new URL(p.editUrl).searchParams.get("k")!;
    expect(await (await call(`${ORIGIN}/edit/${p.slug}?k=${pkey}`)).text()).toMatch(/<fieldset id="team-fieldset"[^>]*\shidden/);
  });

  it("renders team members with names and roles", async () => {
    const { slug, key } = await salon();
    expect((await save(slug, key, { team: "Maria Lopez | Owner & senior stylist\nJames Carter\nPriya Shah | Colour specialist" })).status).toBe(303);
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain('id="team-h"');
    expect(page).toContain("Maria Lopez");
    expect(page).toContain("Owner &amp; senior stylist");
    expect(page).toContain("James Carter"); // role optional
    expect(page).toContain("Colour specialist");
  });

  it("does not render the team section for a non-team business", async () => {
    const plumb = await internalCreate({ slug: "pipe-team2", category: "plumbing", businessName: "Pipe Co2", phone: "(555) 800-3000" });
    const p = (await plumb.json()) as { slug: string; editUrl: string };
    const key = new URL(p.editUrl).searchParams.get("k")!;
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Pipe Co2", category: "plumbing", phone: "(555) 800-3000", city: "Edison", key, team: "Bob | Boss" })) form.set(k, v);
    expect((await call(`${ORIGIN}/api/sites/${p.slug}`, { method: "POST", body: form })).status).toBe(303);
    expect(await (await call(`https://${p.slug}.3pandasite.test/`)).text()).not.toContain('id="team-h"');
  });
});

describe("FAQ (all categories)", () => {
  async function made() {
    const res = await internalCreate({ slug: "faq-co", businessName: "FAQ Co", phone: "(555) 900-1000" });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string>) {
    const form = new FormData();
    const base = { businessName: "FAQ Co", category: "landscaping", phone: "(555) 900-1000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) form.set(k, v);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }

  it("offers the FAQ fieldset on every category (not gated)", async () => {
    const { slug, key } = await made();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).toContain('name="faq"');
    expect(page).toContain("Questions &amp; answers");
  });

  it("renders FAQs as a details/summary accordion (no JS)", async () => {
    const { slug, key } = await made();
    expect((await save(slug, key, { faq: "Do you take walk-ins? | Yes, appointments recommended.\nWhere do you park? | Free lot behind the building." })).status).toBe(303);
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain('id="faq-h"');
    expect(page).toContain("<details><summary>Do you take walk-ins?</summary>");
    expect(page).toContain("Free lot behind the building.");
  });

  it("drops a line with no answer", async () => {
    const { slug, key } = await made();
    await save(slug, key, { faq: "Just a question with no answer\nReal one? | Real answer." });
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).not.toContain("Just a question with no answer");
    expect(page).toContain("Real answer.");
  });
});

describe("featured listings (real estate)", () => {
  async function realtor() {
    const res = await internalCreate({ category: "realestate", businessName: "Keystone Realty", phone: "(555) 950-1000" });
    expect(res.status).toBe(201);
    const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
    return { slug, key: new URL(editUrl).searchParams.get("k")! };
  }
  async function save(slug: string, key: string, fields: Record<string, string | string[]>, files: Record<string, File> = {}) {
    const form = new FormData();
    const base = { businessName: "Keystone Realty", category: "realestate", phone: "(555) 950-1000", city: "Edison", key };
    for (const [k, v] of Object.entries({ ...base, ...fields })) for (const x of Array.isArray(v) ? v : [v]) form.append(k, x);
    for (const [k, f] of Object.entries(files)) form.set(k, f);
    return call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: form });
  }
  const listOf = (slug: string) => (JSON.parse(kv.data.get(`site:${slug}`)!.value) as { listings?: { photo: string; price: string; details: string; status: string }[] }).listings;

  it("shows the Listings fieldset for real estate (gated), hidden for a plumber", async () => {
    const { slug, key } = await realtor();
    const page = await (await call(`${ORIGIN}/edit/${slug}?k=${key}`)).text();
    expect(page).toContain('id="listings-fieldset"');
    expect(page).toContain('data-show-cats="realestate"');
    expect(page).toContain('name="listing1Photo"');
    expect(page).not.toMatch(/<fieldset id="listings-fieldset"[^>]*\shidden/);
    const plumb = await internalCreate({ slug: "pipe-list", category: "plumbing", businessName: "Pipe Co", phone: "(555) 950-2000" });
    const p = (await plumb.json()) as { slug: string; editUrl: string };
    const pkey = new URL(p.editUrl).searchParams.get("k")!;
    expect(await (await call(`${ORIGIN}/edit/${p.slug}?k=${pkey}`)).text()).toMatch(/<fieldset id="listings-fieldset"[^>]*\shidden/);
  });

  it("stores a listing (photo + price + details + status) and renders it", async () => {
    const { slug, key } = await realtor();
    const res = await save(slug, key, { listing1Price: "$450,000", listing1Details: "3 bed · 2 bath", listing1Status: "For sale" }, { listing1Photo: jpeg("home.jpg") });
    expect(res.status).toBe(303);
    const items = listOf(slug)!;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ price: "$450,000", details: "3 bed · 2 bath", status: "For sale" });
    const page = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(page).toContain('id="listings-h"');
    expect(page).toContain("$450,000");
    expect(page).toContain("3 bed · 2 bath");
    expect(page).toContain(`/p/${items[0]!.photo}`);
  });

  it("keeps or removes existing listings, and defaults a bad status", async () => {
    const { slug, key } = await realtor();
    await save(slug, key, { listing1Price: "$1", listing1Status: "nonsense" }, { listing1Photo: jpeg("a.jpg") });
    const first = listOf(slug)!;
    expect(first[0]!.status).toBe("For sale"); // bad status normalised
    const k0 = first[0]!.photo;
    // Save again keeping it -> still there.
    expect((await save(slug, key, { keepListing: k0 })).status).toBe(303);
    expect(listOf(slug)).toHaveLength(1);
    // Save again without keepListing -> removed and photo deleted.
    expect((await save(slug, key, {})).status).toBe(303);
    expect(listOf(slug)).toBeUndefined();
    expect(R2().data.has(k0)).toBe(false);
  });

  it("rejects listings for a non-realestate business", async () => {
    const plumb = await internalCreate({ slug: "pipe-list2", category: "plumbing", businessName: "Pipe Co2", phone: "(555) 950-3000" });
    const p = (await plumb.json()) as { slug: string; editUrl: string };
    const key = new URL(p.editUrl).searchParams.get("k")!;
    const form = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Pipe Co2", category: "plumbing", phone: "(555) 950-3000", city: "Edison", key })) form.append(k, v);
    form.set("listing1Photo", jpeg("x.jpg"));
    const res = await call(`${ORIGIN}/api/sites/${p.slug}`, { method: "POST", headers: { accept: "application/json" }, body: form });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: Record<string, string> }).errors.listings).toBeTruthy();
    expect(listOf(p.slug)).toBeUndefined();
  });
});

describe("edit freshness (no stale browser cache)", () => {
  it("serves customer pages with revalidate, so edits show on the next refresh", async () => {
    const { slug } = await makeSite({ slug: "fresh-co" });
    const res = await call(`https://${slug}.3pandasite.test/`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    // No long-lived max-age that would hide an edit for up to a minute.
    expect(res.headers.get("cache-control")).not.toContain("max-age=60");
  });
});
