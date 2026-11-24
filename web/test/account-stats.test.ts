// My website (/account) shows the site's visitor stats (2026-11-20): Pro sees
// the full breakdown, Basic the 30-day count and the upgrade note. Never on
// the customer site. Whole fetch handler, in-memory KV and a fake D1.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { accountForAdvault, startSession } from "../src/accounts.js";

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
    async put(key: string, value: ArrayBuffer) {
      data.set(key, value);
    },
    async head() {
      return null; // reservations: test/address-race.test.ts
    },
    async get(key: string) {
      const v = data.get(key);
      return v ? { body: new Uint8Array(v), size: v.byteLength, httpMetadata: {} } : null;
    },
    async delete() {},
  };
}

/** readStats' five queries, answered with fixed rows; writes are ignored. */
function statsD1() {
  const answers = [
    [{ views: 42, calls: 7, directions: 3, offer: 0 }],
    [{ day: "2026-11-19", views: 12 }],
    [{ source: "google", views: 30 }],
    [{ city: "Edison", country: "US", views: 25 }],
    [{ device: "mobile", views: 40 }],
  ];
  return {
    prepare() {
      return { bind: () => ({ run: async () => undefined }) };
    },
    async batch(stmts: unknown[]) {
      return stmts.map((_, i) => ({ results: answers[i] ?? [] }));
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
const EMAIL = "owner@example.com";

beforeEach(() => {
  kv = memoryKv();
  pending = [];
  env = { SITES: kv, PHOTOS: memoryR2(), STATS: statsD1(), PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: TOKEN, BILLING: "on", ADMIN_EMAILS: "boss@example.com" };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

/** An AdVault-made site (a year of Pro), owned by the shared account; returns a signed-in cookie. */
async function ownerWithSite(plan: "pro" | "basic" = "pro", email = EMAIL, advId = ADV_ID): Promise<{ cookie: string; slug: string }> {
  const form = new FormData();
  const fields = { businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison", slug: "green-lawns", ownerAdvaultUserId: advId, ownerEmail: email };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  expect(res.status).toBe(201);
  const { slug } = (await res.json()) as { slug: string };
  if (plan === "basic") {
    const key = `site:${slug}`;
    const e = kv.data.get(key)!;
    const site = JSON.parse(e.value);
    site.billing = { ...site.billing, plan: "basic", status: "active", paidUntil: new Date(Date.now() + 200 * 86_400_000).toISOString() };
    kv.data.set(key, { ...e, value: JSON.stringify(site) });
  }
  const account = await accountForAdvault(kv as unknown as KVNamespace, { advaultUserId: advId, email });
  return { cookie: `sv_session=${await startSession(kv as unknown as KVNamespace, account.id)}`, slug };
}

describe("/account visitor stats", () => {
  it("Pro: the full stats, open under the site link", async () => {
    const { cookie } = await ownerWithSite("pro");
    const html = await (await call(`${ORIGIN}/account`, { headers: { cookie } })).text();
    expect(html).toContain("Visitors (last 30 days)");
    expect(html).toContain("<strong>42</strong> visits in the last 30 days");
    expect(html).toMatch(/Taps to call<\/dt><dd>7<\/dd>/);
    expect(html).toContain("Where visitors came from");
    expect(html).toContain("Edison, US");
    expect(html).toContain("Visits by day");
    expect(html).not.toContain("Upgrade to Pro to see");
    // Open, not a collapsed <details>, and under the site link.
    const at = html.indexOf("Visitors (last 30 days)");
    expect(html.lastIndexOf("<details", at)).toBeLessThan(html.lastIndexOf("green-lawns.3pandasite.test", at));
    expect(html.indexOf("green-lawns.3pandasite.test")).toBeLessThan(at);
  });

  it("Basic: the 30-day count and the upgrade note, no breakdown", async () => {
    const { cookie } = await ownerWithSite("basic");
    const html = await (await call(`${ORIGIN}/account`, { headers: { cookie } })).text();
    expect(html).toContain("Visitors (last 30 days)");
    expect(html).toContain("<strong>42</strong> visits in the last 30 days");
    expect(html).toContain("Upgrade to Pro to see where visitors come from");
    expect(html).not.toContain("Taps to call");
    expect(html).not.toContain("Where visitors came from");
  });

  it("the edit page shows them in its Stats tab; the customer site never shows stats", async () => {
    const { cookie, slug } = await ownerWithSite("pro");
    const edit = await (await call(`${ORIGIN}/edit/${slug}`, { headers: { cookie } })).text();
    expect(edit).toMatch(/<div class="opanel" role="tabpanel" id="stats"[^>]*>\s*<h2>Visitors \(last 30 days\)<\/h2>\s*<p><strong>42<\/strong> visits/);
    expect(edit).not.toContain('<details class="section"><summary>Visitors');
    const pub = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(pub).not.toContain("visits in the last 30 days");
    expect(pub).not.toContain("Visitors (last 30 days)");
  });

  it("admins' /account is unchanged (no stats)", async () => {
    const { cookie } = await ownerWithSite("pro", "boss@example.com", "33333333-2222-3333-4444-555555555555");
    const html = await (await call(`${ORIGIN}/account`, { headers: { cookie } })).text();
    expect(html).toContain("My websites");
    expect(html).not.toContain("Visitors (last 30 days)");
  });
});
