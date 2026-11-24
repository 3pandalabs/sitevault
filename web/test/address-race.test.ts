// QA 2026-11-23: two owners must never get one address. R2 here honours
// conditional puts like the real one; KV can serve stale "not found" reads.
// Also the https redirect, HSTS, the wordmark font and the sitemap.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";

const ORIGIN = "https://sitevault.test";
const TOKEN = "internal-token";
const MINUTE = 60_000;

let sites: Map<string, string>;
let objects: Map<string, { etag: string; uploaded: Date }>;
/** KV keys whose reads still say "not found" (negative cache in another location). */
let stale: Set<string>;
let failUpload: boolean;
let env: Record<string, unknown>;

beforeEach(() => {
  sites = new Map();
  objects = new Map();
  stale = new Set();
  failUpload = false;
  let etag = 0;
  env = {
    SITES: {
      async get(key: string, type?: string) {
        const v = stale.has(key) ? undefined : sites.get(key);
        return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
      },
      async put(key: string, value: string) {
        sites.set(key, value);
      },
      async delete(key: string) {
        sites.delete(key);
      },
      async list({ prefix = "" }: { prefix?: string } = {}) {
        return { keys: [...sites.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
      },
    },
    PHOTOS: {
      async put(key: string, _v: unknown, opts?: { onlyIf?: Headers | { etagMatches: string } }) {
        if (failUpload && key.startsWith("sites/")) throw new Error("upload failed");
        const cur = objects.get(key);
        const c = opts?.onlyIf;
        if (c instanceof Headers && c.get("if-none-match") === "*" && cur) return null;
        if (c && "etagMatches" in c && cur?.etag !== c.etagMatches) return null;
        const o = { etag: String((etag += 1)), uploaded: new Date() };
        objects.set(key, o);
        return o;
      },
      async head(key: string) {
        return objects.get(key) ?? null;
      },
      async get() {
        return null;
      },
      async delete(keys: string | string[]) {
        for (const k of [keys].flat()) objects.delete(k);
      },
    },
    PUBLIC_ORIGIN: ORIGIN,
    SITES_DOMAIN: "3pandasite.test",
    INTERNAL_TOKEN: TOKEN,
    BILLING: "off",
    DAILY_CREATE_LIMIT: "50",
    ADMIN_EMAILS: "",
  };
});

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const call = (url: string, init: RequestInit = {}) => worker.fetch(new Request(url, { redirect: "manual", ...init }) as never, env as never, ctx);

let phone = 0;
function form(fields: Record<string, string>, photo = false): FormData {
  const f = new FormData();
  phone += 1;
  for (const [k, v] of Object.entries({ businessName: "Green Lawns", category: "landscaping", phone: `(555) 201-${1000 + phone}`, city: "Edison", ...fields })) f.set(k, v);
  if (photo) f.append("photos", new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], "a.jpg", { type: "image/jpeg" }));
  return f;
}
const internal = (fields: Record<string, string>, photo = false) =>
  call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: form(fields, photo) });
const web = (fields: Record<string, string>) =>
  call(`${ORIGIN}/api/sites`, {
    method: "POST",
    headers: { accept: "application/json", origin: ORIGIN, "cf-connecting-ip": "192.0.2.1" },
    body: form({ attest: "yes", acct_email: `o${phone}@example.com`, acct_password: "long-enough-pw-1", ...fields }),
  });
const rename = (made: { editUrl: string }, slug: string) => {
  const u = new URL(made.editUrl);
  return call(`${ORIGIN}/api/sites/${u.pathname.split("/").pop()}`, {
    method: "POST",
    headers: { accept: "application/json", origin: ORIGIN },
    body: form({ key: u.searchParams.get("k")!, slug }),
  });
};
type Made = { slug: string; editUrl: string };
const siteName = (slug: string) => (JSON.parse(sites.get(`site:${slug}`)!) as { businessName: string }).businessName;
const available = async (slug: string) => ((await (await call(`${ORIGIN}/api/address?slug=${slug}`)).json()) as { available: boolean }).available;

describe("one address, one owner", () => {
  it.each([
    ["internal", internal, 201],
    ["public builder", web, 200],
  ] as const)("%s: two creates at once, one wins", async (_n, create, ok) => {
    const res = await Promise.all([create({ slug: "dream-cuts", businessName: "First" }), create({ slug: "dream-cuts", businessName: "Second" })]);
    expect(res.map((r) => r.status).sort()).toEqual([ok, 400].sort());
    const lost = res.find((r) => r.status === 400)!;
    expect(((await lost.json()) as { errors: { slug: string } }).errors.slug).toContain("taken");
    const winner = res.findIndex((r) => r.status === ok) === 0 ? "First" : "Second";
    expect(siteName("dream-cuts")).toBe(winner);
    // The public loser has no half-made account left behind.
    if (create === web) expect([...sites.keys()].filter((k) => k.startsWith("acctemail:"))).toHaveLength(1);
  });

  it("default addresses: two at once get different ones", async () => {
    const res = await Promise.all([internal({}), internal({})]);
    const slugs = await Promise.all(res.map(async (r) => ((await r.json()) as Made).slug));
    expect(new Set(slugs).size).toBe(2);
  });

  it("a stale KV 'not found' can't overwrite a site, and /api/address says taken", async () => {
    await internal({ slug: "dream-cuts", businessName: "First" });
    stale.add("site:dream-cuts");
    expect(await available("dream-cuts")).toBe(false);
    expect((await internal({ slug: "dream-cuts", businessName: "Second" })).status).toBe(400);
    expect(siteName("dream-cuts")).toBe("First");
  });

  it("renames: two at once, one wins; a rename and a create can't share either", async () => {
    const a = (await (await internal({ slug: "shop-a" })).json()) as Made;
    const b = (await (await internal({ slug: "shop-b" })).json()) as Made;
    const res = await Promise.all([rename(a, "best-shop"), rename(b, "best-shop")]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 400]);
    const loser = res[0]!.status === 400 ? a : b;
    const mix = await Promise.all([rename(loser, "top-shop"), internal({ slug: "top-shop" })]);
    expect(mix.filter((r) => r.status < 300)).toHaveLength(1);
  });

  it("an old site's address stays held right after its rename, before its alias shows", async () => {
    const a = (await (await internal({ slug: "shop-a" })).json()) as Made;
    objects.delete("addr/shop-a"); // made before reservations existed
    expect((await rename(a, "shop-new")).status).toBe(200);
    stale.add("alias:shop-a");
    expect((await internal({ slug: "shop-a" })).status).toBe(400);
    // Going back to its own old address still works.
    stale.clear();
    const u = new URL(a.editUrl);
    expect((await rename({ editUrl: `${ORIGIN}/edit/shop-new?k=${u.searchParams.get("k")}` }, "shop-a")).status).toBe(200);
  });

  it("existing sites and aliases stay taken with no reservation and after it ages", async () => {
    await internal({ slug: "dream-cuts" });
    if (objects.has("addr/dream-cuts")) objects.get("addr/dream-cuts")!.uploaded = new Date(Date.now() - 60 * MINUTE);
    expect((await internal({ slug: "dream-cuts" })).status).toBe(400);
    objects.delete("addr/dream-cuts");
    expect(await available("dream-cuts")).toBe(false);
    sites.set("alias:old-cuts", "dream-cuts");
    expect((await internal({ slug: "old-cuts" })).status).toBe(400);
  });

  it("a leftover reservation is taken over after 10 minutes, by one request only", async () => {
    objects.set("addr/dream-cuts", { etag: "x", uploaded: new Date(Date.now() - 9 * MINUTE) });
    expect((await internal({ slug: "dream-cuts" })).status).toBe(400);
    objects.set("addr/dream-cuts", { etag: "x", uploaded: new Date(Date.now() - 11 * MINUTE) });
    const res = await Promise.all([internal({ slug: "dream-cuts" }), internal({ slug: "dream-cuts" })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 400]);
  });

  it("a failed upload or an admin delete frees the address", async () => {
    failUpload = true;
    expect((await internal({ slug: "dream-cuts" }, true)).status).toBe(500);
    failUpload = false;
    expect((await internal({ slug: "dream-cuts" })).status).toBe(201);
    const del = await call(`${ORIGIN}/api/internal/sites/dream-cuts?advaultUserId=11111111-2222-3333-4444-555555555555&email=`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(((await del.json()) as { deleted: boolean }).deleted).toBe(true);
    expect((await internal({ slug: "dream-cuts" })).status).toBe(201);
  });
});

describe("main host: https, HSTS", () => {
  it.each(["GET", "HEAD"])("%s http redirects 301, keeping path and query", async (method) => {
    const r = await call("http://sitevault.test/edit/x?k=a%20b", { method });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://sitevault.test/edit/x?k=a%20b");
    expect(r.headers.get("strict-transport-security")).toBeNull();
  });
  it("POST keeps its method (308); webhooks are not redirected", async () => {
    expect((await call("http://sitevault.test/login", { method: "POST", body: "a=1" })).status).toBe(308);
    expect((await call("http://sitevault.test/webhooks/stripe", { method: "POST", body: "{}" })).status).toBe(503);
  });
  it("https is served with a one-day HSTS, on redirects and 404s too, never looping", async () => {
    for (const p of ["/", "/nothing", "/admin", "/s/some-site"]) {
      const r = await call(`${ORIGIN}${p}`);
      expect(r.headers.get("strict-transport-security")).toBe("max-age=86400");
      expect(r.headers.get("location")).not.toBe(`${ORIGIN}${p}`);
    }
    expect((await call(`${ORIGIN}/`)).status).toBe(200);
  });
  it("customer hosts, the apex and an http (local) origin are unchanged", async () => {
    await internal({ slug: "dream-cuts" });
    for (const u of ["http://dream-cuts.3pandasite.test/", "https://dream-cuts.3pandasite.test/", "https://3pandasite.test/"]) {
      const r = await call(u);
      expect(r.status).toBe(u.includes("dream") ? 200 : 301);
      expect(r.headers.get("strict-transport-security")).toBeNull();
    }
    env.PUBLIC_ORIGIN = "http://localhost:8787";
    const local = await call("http://localhost:8787/");
    expect(local.status).toBe(200);
    expect(local.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("assets and sitemap", () => {
  it.each([ORIGIN, "https://dream-cuts.3pandasite.test", "https://any-other.workers.test"])("%s serves the wordmark font", async (o) => {
    const r = await call(`${o}/_f/wordmark.woff2`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("font/woff2");
  });
  it("every root-relative asset a rendered site uses is served on the main host", async () => {
    const a = (await (await internal({ slug: "dream-cuts" })).json()) as Made;
    const u = new URL(a.editUrl);
    const page = await (await call(`${ORIGIN}${u.pathname}/view${u.search}`)).text();
    const refs = [...page.matchAll(/(?:url\(["']?|\bsrc="|<link[^>]*\bhref=")(\/(?!\/)[^"')]+)/g)].map((m) => m[1]!);
    expect(refs).toContain("/_f/wordmark.woff2");
    for (const ref of refs) expect((await call(`${ORIGIN}${ref}`)).status, ref).toBe(200);
  });
  it("sitemap: exactly the public main-host pages, all 200 and allowed by robots.txt", async () => {
    const r = await call(`${ORIGIN}/sitemap.xml`);
    expect(r.headers.get("content-type")).toContain("application/xml");
    const locs = [...(await r.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(locs).toEqual(["/", "/new", "/faq", "/privacy", "/terms", "/contact"].map((p) => ORIGIN + p));
    const robots = await (await call(`${ORIGIN}/robots.txt`)).text();
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    for (const l of locs) {
      expect((await call(l)).status).toBe(200);
      expect(robots).not.toContain(`Disallow: ${new URL(l).pathname}\n`);
    }
  });
});

it("the done page doesn't claim the edit link is the only way in", async () => {
  const res = await call(`${ORIGIN}/api/sites`, { method: "POST", headers: { origin: ORIGIN }, body: form({ attest: "yes", acct_email: "o@example.com", acct_password: "long-enough-pw-1" }) });
  const page = await res.text();
  expect(res.status).toBe(201);
  expect(page).not.toContain("only way");
  expect(page).toContain("sign in and open");
});
