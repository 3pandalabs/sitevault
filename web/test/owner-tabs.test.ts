// The owner's edit page (2026-11-20): three tabs (Edit your website | View
// your website | Stats), the form beside a same-origin live view, and stats
// with Bars | Pie | Table views as server-side SVG. AdVault's embed mode is
// unchanged. Whole fetch handler with in-memory KV/R2 and a fake D1.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { accountForAdvault, startSession } from "../src/accounts.js";
import { bucket, chartCard, pieSvg, PIE_MAX } from "../src/charts.js";
import { builderPage, statsPanel } from "../src/pages.js";
import { planPrices } from "../src/billing.js";
import type { Site } from "../src/site.js";
import type { SiteStats } from "../src/stats.js";

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

const SOURCES = ["google", "youtube", "facebook", "instagram", "whatsapp", "advault", "direct", "other"];
/** readStats' five queries: 8 sources (so the pie needs "Other"). Counting views writes are ignored. */
function statsD1() {
  const answers = [
    [{ views: 100, calls: 7, directions: 3, offer: 2 }],
    [
      { day: "2026-11-18", views: 30 },
      { day: "2026-11-19", views: 70 },
    ],
    SOURCES.map((source, i) => ({ source, views: 40 - i * 5 })),
    [{ city: "Edison", country: "US", views: 60 }, { city: "Newark", country: "US", views: 40 }],
    [{ device: "mobile", views: 80 }, { device: "desktop", views: 20 }],
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
  env = { SITES: kv, PHOTOS: memoryR2(), STATS: statsD1(), PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: TOKEN, BILLING: "on" };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

/** An AdVault-made site (a year of Pro), owned by the shared account; optionally pending (unpublished). */
async function ownerWithSite(opts: { basic?: boolean } = {}): Promise<{ cookie: string; slug: string }> {
  const form = new FormData();
  const fields: Record<string, string> = { businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison", slug: "green-lawns", ownerAdvaultUserId: ADV_ID, ownerEmail: EMAIL };
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: form });
  expect(res.status).toBe(201);
  const { slug } = (await res.json()) as { slug: string };
  if (opts.basic) {
    const key = `site:${slug}`;
    const e = kv.data.get(key)!;
    const site = JSON.parse(e.value);
    site.billing = { ...site.billing, plan: "basic", status: "active", paidUntil: new Date(Date.now() + 200 * 86_400_000).toISOString() };
    kv.data.set(key, { ...e, value: JSON.stringify(site) });
  }
  const account = await accountForAdvault(kv as unknown as KVNamespace, { advaultUserId: ADV_ID, email: EMAIL });
  return { cookie: `sv_session=${await startSession(kv as unknown as KVNamespace, account.id)}`, slug };
}

const editPage = async (o: Parameters<typeof ownerWithSite>[0] = {}) => {
  const { cookie, slug } = await ownerWithSite(o);
  const res = await call(`${ORIGIN}/edit/${slug}`, { headers: { cookie } });
  return { res, html: await res.text(), cookie, slug };
};

describe("tabs", () => {
  it("three tabs with hash ids, an accessible tablist, panels in order", async () => {
    const { html } = await editPage();
    expect(html).toContain('<div class="otabs" role="tablist" aria-label="Your website">');
    for (const [id, label, sel] of [["edit", "Edit your website", "true"], ["view", "View your website", "false"], ["stats", "Stats", "false"]]) {
      expect(html).toContain(`<a class="otab" role="tab" id="tab-${id}" href="#${id}" aria-controls="${id}" aria-selected="${sel}">${label}</a>`);
      expect(html).toContain(`<div class="opanel" role="tabpanel" id="${id}" aria-labelledby="tab-${id}">`);
    }
    const at = (s: string) => html.indexOf(s);
    expect(at('id="edit"')).toBeLessThan(at('id="view"'));
    expect(at('id="view"')).toBeLessThan(at('id="stats"'));
    // No-JS: no panel is hidden in the markup (the script sets data-tab).
    expect(html).toContain('<div class="opanels" id="owner-panels">');
    // The script: arrow keys, hash, aria-selected.
    expect(html).toContain("ArrowRight");
    expect(html).toContain("hashchange");
    expect(html).toContain("aria-selected");
  });

  it("the Edit tab keeps the form, preview, billing, reviews and the AdVault anchors", async () => {
    const { html } = await editPage();
    const edit = html.slice(html.indexOf('id="edit"'), html.indexOf('id="view" aria-labelledby'));
    expect(edit).toContain('<form id="builder"');
    expect(edit).toContain("data-owner-tabs");
    expect(edit).toContain('id="website-style"');
    expect(edit).toContain('id="submit"');
    expect(edit).toContain('id="preview-btn" data-preview formaction="/preview?site=green-lawns" formtarget="_blank"');
    expect(edit).toContain('id="reviews"');
    expect(edit).toContain("Plan &amp; billing");
  });

  it("side by side: the View panel frames the saved site on our own origin", async () => {
    const { html, res } = await editPage();
    expect(html).toContain('<iframe class="sv-frame" name="sv-view" id="sv-view" title="Your website" src="/edit/green-lawns/view" loading="lazy"></iframe>');
    expect(html).toContain('id="refresh-preview" data-preview formaction="/preview?site=green-lawns" formtarget="sv-view" formnovalidate');
    expect(html).toContain('form="builder"');
    expect(html).toContain("grid-template-columns:minmax(0,1fr) minmax(0,1fr)");
    expect(html).toContain("@media (min-width:1024px)");
    expect(html).toContain("live at <a href=\"https://green-lawns.3pandasite.test/\"");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-src 'self'");
    // The editor itself still can't be framed.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBeNull();
  });

  it("an unpublished site says so in the View tab (and offers no live link)", async () => {
    const { slug } = await ownerWithSite();
    const site = JSON.parse(kv.data.get(`site:${slug}`)!.value) as Site;
    const billing = { state: "unpublished", billing: {}, source: "web", prices: planPrices("web"), paidUntil: null, justPaid: false } as const;
    const html = builderPage({ kind: "edit", site, key: "k", photoUrl: (k) => k, siteUrl: "https://green-lawns.3pandasite.test/", billing: billing as never }, "N", {}, {}, "3pandasite.test");
    expect(html).toContain("Not published yet. This is how your website will look.");
    expect(html).toContain('src="/edit/green-lawns/view?k=k"');
    expect(html).not.toContain("Open in a new tab");
  });

  it("/account links into the tabs", async () => {
    const { cookie } = await ownerWithSite();
    const html = await (await call(`${ORIGIN}/account`, { headers: { cookie } })).text();
    expect(html).toContain('href="/edit/green-lawns#edit">Edit your website</a>');
    expect(html).toContain('href="/edit/green-lawns#view">View your website</a>');
    expect(html).toContain('href="/edit/green-lawns#stats">Stats</a>');
  });
});

describe("the right-side view (GET /edit/<slug>/view)", () => {
  it("renders the saved site for its owner: framable by our own pages only, not counted, noindex", async () => {
    const { cookie, slug } = await ownerWithSite();
    const res = await call(`${ORIGIN}/edit/${slug}/view`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("advault");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const html = await res.text();
    expect(html).toContain("Green Lawns");
    expect(html).toContain("Your website as saved. It is live at https://green-lawns.3pandasite.test.");
    expect(html).toContain('<meta name="robots" content="noindex">');
    // No tap pings from the owner's own view.
    expect(html).not.toContain(" ping=");
    // Links leave the frame (the customer host refuses to be framed).
    expect(html).not.toMatch(/<a (?![^>]*target=)[^>]*href="https:/);
  });

  it("refuses without the edit key or the owner's session (still a framable error page)", async () => {
    const { slug } = await ownerWithSite();
    const res = await call(`${ORIGIN}/edit/${slug}/view`);
    expect(res.status).toBe(403);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  it("customer sites still refuse every frame", async () => {
    const { slug } = await ownerWithSite();
    const res = await call(`https://${slug}.3pandasite.test/`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("the preview can open in the right side (frame-ancestors 'self', never a third party)", async () => {
    const { cookie, slug } = await ownerWithSite();
    const f = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison" })) f.set(k, v);
    const res = await call(`${ORIGIN}/preview?site=${slug}`, { method: "POST", body: f, headers: { origin: ORIGIN, cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(await res.text()).toContain("Preview — not published yet");
  });
});

describe("stats views", () => {
  it("Pro: every breakdown has its toggle and all views in the HTML", async () => {
    const { html } = await editPage();
    const stats = html.slice(html.indexOf('id="stats" aria-labelledby'));
    for (const id of ["st-sources", "st-places", "st-devices", "st-taps"]) {
      const card = stats.slice(stats.indexOf(`id="${id}"`), stats.indexOf("</section>", stats.indexOf(`id="${id}"`)));
      expect(card).toContain('data-view="bars" aria-pressed="true">Bars</button>');
      expect(card).toContain('data-view="pie" aria-pressed="false">Pie</button>');
      expect(card).toContain('data-view="table" aria-pressed="false">Table</button>');
      expect(card).toContain('<div class="view" data-view="bars">');
      expect(card).toContain('<div class="view" data-view="pie" hidden>');
      expect(card).toContain('<div class="view" data-view="table" hidden>');
    }
    const days = stats.slice(stats.indexOf('id="st-days"'));
    expect(days).toContain('data-view="line" aria-pressed="true">Line</button>');
    expect(days).toContain('data-view="columns" aria-pressed="false">Bars</button>');
    expect(days).toMatch(/<polyline points="[^"]+"/);
    expect(stats).toContain("Taps on the offer");
    expect(stats).not.toContain("Upgrade to Pro");
  });

  it("Basic: the 30-day count and the upgrade note, no charts", async () => {
    const { html } = await editPage({ basic: true });
    const stats = html.slice(html.indexOf('id="stats" aria-labelledby'));
    expect(stats).toContain("<strong>100</strong> visits in the last 30 days");
    expect(stats).toContain("Upgrade to Pro to see where visitors come from");
    expect(stats).not.toContain("<svg");
    expect(stats).not.toContain("data-chart>");
  });

  it("no stats binding: a short note, no charts", () => {
    expect(statsPanel(undefined)).toContain("aren't available");
  });

  it("the customer site never shows stats or charts", async () => {
    const { slug } = await ownerWithSite();
    const pub = await (await call(`https://${slug}.3pandasite.test/`)).text();
    expect(pub).not.toContain("visits in the last 30 days");
    expect(pub).not.toContain("data-chart>");
  });
});

describe("pie chart", () => {
  const rows = SOURCES.map((s, i) => ({ label: s, n: 40 - i * 5 }));

  it(`buckets past ${PIE_MAX} slices into "Other"`, () => {
    const b = bucket(rows);
    expect(b).toHaveLength(PIE_MAX + 1);
    expect(b[b.length - 1]).toEqual({ label: "Other", n: 10 + 5 });
    expect(bucket(rows.slice(0, 3))).toHaveLength(3);
  });

  it("slices sum to 360 degrees and 100%, labelled with names and percentages, role=img", () => {
    const svg = pieSvg("Where visitors came from", rows);
    const deg = [...svg.matchAll(/data-deg="([\d.]+)"/g)].reduce((s, m) => s + Number(m[1]), 0);
    const pct = [...svg.matchAll(/data-pct="([\d.]+)"/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(deg).toBeCloseTo(360, 0);
    expect(pct).toBeCloseTo(100, 0);
    expect([...svg.matchAll(/class="slice"/g)]).toHaveLength(PIE_MAX + 1);
    expect(svg).toMatch(/<svg [^>]*role="img" aria-label="Where visitors came from: google 22%, [^"]*Other 8\.3%\."/);
    expect(svg).toContain('<span class="pv">22%</span>');
    expect(svg).toContain("#71717a"); // "Other" is neutral grey, not a series hue
  });

  it("one source = a full circle at 100%", () => {
    const svg = pieSvg("Devices", [{ label: "Mobile", n: 5 }]);
    expect(svg).toContain('<circle class="slice"');
    expect(svg).toContain('data-pct="100"');
  });

  it("escapes labels and keeps a table fallback", () => {
    const card = chartCard("x", "Where visitors are", "Place", [{ label: "<b>Town</b>", n: 2 }], "category");
    expect(card).not.toContain("<b>Town</b>");
    expect(card).toContain("&lt;b&gt;Town&lt;/b&gt;");
    expect(card).toMatch(/<div class="view" data-view="table" hidden><table class="bars data">/);
  });
});

describe("AdVault embed mode is unchanged", () => {
  it("single column, no tabs, no frame, no charts; AdVault may still frame it", async () => {
    const { cookie, slug } = await ownerWithSite();
    const res = await call(`${ORIGIN}/edit/${slug}?embed=1`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Edit your website</h1>");
    expect(html).toContain('id="builder"');
    expect(html).toContain('id="website-style"');
    expect(html).toContain("sitevault:height");
    expect(html).toContain("sitevault:sections");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(" data-owner-tabs>");
    expect(html).not.toContain("data-chart>");
    expect(html).toMatch(/<details class="section"><summary>Visitors <span class="sum">— 100 visits/);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors https://advault.3pandalabs.com");
    expect(csp).not.toContain("frame-src");
  });

  it("saving from the embed still returns to the embed editor (no `edit` reload hint)", async () => {
    const { cookie, slug } = await ownerWithSite();
    const f = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison", attest: "yes", embed: "1" })) f.set(k, v);
    const res = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: f, headers: { origin: ORIGIN, cookie, accept: "application/json" } });
    const body = (await res.json()) as { ok: boolean; next: string; edit?: string };
    expect(body.ok).toBe(true);
    expect(body.next).toBe(`${ORIGIN}/edit/${slug}?embed=1&saved=1`);
    expect(body.edit).toBeUndefined();
  });

  it("saving on SiteVault returns where the tabbed page reloads to", async () => {
    const { cookie, slug } = await ownerWithSite();
    const f = new FormData();
    for (const [k, v] of Object.entries({ businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Edison", attest: "yes" })) f.set(k, v);
    const res = await call(`${ORIGIN}/api/sites/${slug}`, { method: "POST", body: f, headers: { origin: ORIGIN, cookie, accept: "application/json" } });
    const body = (await res.json()) as { ok: boolean; edit?: string };
    expect(body.ok).toBe(true);
    expect(body.edit).toBe(`${ORIGIN}/edit/${slug}`);
    const saved = await (await call(`${ORIGIN}/edit/${slug}?saved=1`, { headers: { cookie } })).text();
    expect(saved).toContain('id="owner-saved"');
  });
});
