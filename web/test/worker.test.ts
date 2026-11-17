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
