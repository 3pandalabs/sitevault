// Android app: payments on the website only (2026-11-26, TODO(android-payments)
// in src/app.ts). Detection (?source=twa, android-app:// referrer, sv_app
// cookie) and that no payment option or link is ever sent to the app.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { APP_PAYMENTS_MESSAGE, APP_REFERRER, appSignal, isAppRequest, payDrop, payOnly, stripPayments } from "../src/app.js";
import { initialBilling, planPrices, type Billing, type BillingConfig } from "../src/billing.js";
import { billingSection, donePage, homePage, type BillingView } from "../src/pages.js";
import { parseContent, type Site } from "../src/site.js";
import { sha256Hex } from "../src/util.js";

const ORIGIN = "https://sitevault.test";
const ON: BillingConfig = { on: true, earlyAccessUntil: "2027-01-31" };
const KEY = "edit-key-abcdefghij";
const NOW = new Date("2026-11-26T00:00:00Z");
const MSG = APP_PAYMENTS_MESSAGE.replace(/'/g, "&#39;");

/** Every way to pay or reach a payment page. */
const PAY_PATTERNS = [/\/api\/billing\//, /stripe\.com/, /siteOffer=/, /Make a YouTube ad, \$/, /Finish in AdVault<\/a>/, /pay \$\d+ \(the first year/,/Buy \d+ offer credits/, /Manage billing<\/button>/, /Publish: \$/, /Upgrade to Pro: \$/];
const noPayment = (h: string) => {
  for (const p of PAY_PATTERNS) expect(h, String(p)).not.toMatch(p);
};

describe("detection", () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });
  it("?source=twa and the app's android-app:// referrer are app signals", () => {
    expect(appSignal(req(`${ORIGIN}/?source=twa`))).toBe(true);
    expect(appSignal(req(`${ORIGIN}/new`, { referer: `${APP_REFERRER}/` }))).toBe(true);
    expect(appSignal(req(`${ORIGIN}/new`, { referer: "android-app://com.android.chrome/" }))).toBe(false);
    expect(appSignal(req(`${ORIGIN}/?source=web`))).toBe(false);
  });
  it("the sv_app cookie keeps app mode on later pages; nothing else does", () => {
    expect(isAppRequest(req(`${ORIGIN}/account`, { cookie: "sv_session=x; sv_app=1" }))).toBe(true);
    expect(isAppRequest(req(`${ORIGIN}/account`, { cookie: "sv_session=x" }))).toBe(false);
    expect(isAppRequest(req(`${ORIGIN}/account`, { cookie: "sv_app=0" }))).toBe(false);
    expect(isAppRequest(req(`${ORIGIN}/account`))).toBe(false);
  });
});

describe("stripPayments", () => {
  it("replaces marked blocks with one message (adjacent merged) and drops payDrop text", () => {
    const h = stripPayments(`<p>a</p>${payOnly("<form>x</form>")} ${payOnly("<b>y</b>")}${payDrop("<a>z</a>")}<p>b</p>`);
    expect(h).toBe(`<p>a</p><p class="hint" data-app-pay-note>${MSG}</p><p>b</p>`);
  });
  it("backstop: removes unmarked billing forms and Stripe/siteOffer links", () => {
    const h = stripPayments(`<form method="post" action="/api/billing/checkout"><button>Pay</button></form><a href="https://checkout.stripe.com/x">pay</a><a href="https://advault.test/dashboard?siteOffer=a">ad</a>`);
    noPayment(h);
    expect(h).toContain(MSG);
  });
  it("the message has no link and no URL", () => {
    expect(APP_PAYMENTS_MESSAGE).not.toMatch(/https?:|www\.|\.com|<a/i);
  });
});

const view = (billing: Billing, source: "web" | "advault" = "web", extra: Partial<BillingView> = {}): BillingView => ({
  state: billing.status === "pending" ? "unpublished" : "live",
  billing,
  source,
  prices: planPrices(source),
  paidUntil: billing.paidUntil ? new Date(billing.paidUntil) : null,
  justPaid: false,
  now: NOW,
  ...extra,
});
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("pages in app mode: every payment option hidden", () => {
  const cases: [string, string][] = [
    ["unpublished SiteVault site (publish buttons)", billingSection("s", "k", view(initialBilling("web", ON, NOW)!), "https://s/")],
    ["unpaid AdVault site ($10 fee, Finish in AdVault)", billingSection("s", "k", view(initialBilling("advault", ON, NOW, true)!, "advault"))],
    ["Basic site near renewal (renew, upgrade, credits, portal)", billingSection("s", "k", view({ status: "active", plan: "basic", buildPaid: true, paidUntil: day(10), renewing: false, credits: 0, customerId: "cus_1" }))],
    ["overdue Pro site", billingSection("s", "k", view({ status: "active", plan: "pro", buildPaid: true, paidUntil: day(-3), renewing: false, credits: 1, customerId: "cus_1" }, "web", { state: "grace" }))],
    ["done page with publish", donePage({ siteUrl: "https://a/", editUrl: "https://e/", nonce: "n", publish: { slug: "a", key: "k", prices: planPrices("web") } })],
    ["home page (AdVault $10 / ad promo)", homePage(true, null, false, true)],
  ];
  for (const [name, page] of cases) {
    it(name, () => {
      // Sanity: the browser version does have a payment option (the test can go red).
      expect(PAY_PATTERNS.some((p) => p.test(page))).toBe(true);
      const app = stripPayments(page);
      noPayment(app);
      if (!name.startsWith("home")) expect(app).toContain(MSG);
      expect(app.split("data-app-pay-note").length - 1).toBeLessThanOrEqual(1);
    });
  }
});

// Worker level: the whole fetch handler.
function memoryKv() {
  const data = new Map<string, { value: string }>();
  return {
    data,
    async get(key: string, type?: string) {
      const e = data.get(key);
      if (!e) return null;
      return type === "json" ? JSON.parse(e.value) : e.value;
    },
    async put(key: string, value: string) {
      data.set(key, { value });
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: undefined };
    },
  };
}

let env: Record<string, unknown>;
let kv: ReturnType<typeof memoryKv>;
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext;
const call = (url: string, init: RequestInit = {}) => worker.fetch(new Request(url, init) as never, env as never, ctx());

async function seed(slug: string, billing: Billing) {
  const parsed = parseContent({ businessName: "Wax and Wheels", category: "carwash", phone: "(555) 123-0000", city: "Edison, NJ" });
  if (!parsed.ok) throw new Error("fixture invalid");
  const site: Site = { ...parsed.value, slug, photos: [], status: "live", source: "web", editKeyHash: await sha256Hex(KEY), createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-20T00:00:00Z", billing };
  await kv.put(`site:${slug}`, JSON.stringify(site));
}

beforeEach(() => {
  kv = memoryKv();
  env = { SITES: kv, PHOTOS: {}, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", BILLING: "on", STRIPE_SECRET_KEY: "sk_test_x" };
});

describe("worker in app mode", () => {
  it("?source=twa sets the sv_app session cookie and marks the page; the browser gets neither", async () => {
    const app = await call(`${ORIGIN}/?source=twa`);
    const cookie = app.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sv_app=1");
    expect(cookie).not.toMatch(/max-age|expires/i);
    const body = await app.text();
    expect(body).toContain("data-sv-app");
    // The injected script runs under the page's CSP.
    const nonce = body.match(/<script nonce="([^"]+)">\(function\(\)\{try\{var s=window\.sessionStorage/)?.[1];
    expect(nonce).toBeTruthy();
    expect(app.headers.get("content-security-policy")).toContain(`'nonce-${nonce}'`);
    noPayment(body);

    const web = await call(`${ORIGIN}/`);
    expect(web.headers.get("set-cookie")).toBeNull();
    const webBody = await web.text();
    expect(webBody).not.toContain("data-sv-app");
    expect(webBody).toMatch(/Make a YouTube ad, \$/);
  });

  it("edit page: publish/renew/upgrade/credits/portal buttons never rendered in the app; free editing still there", async () => {
    await seed("wax", { status: "active", plan: "basic", buildPaid: true, paidUntil: new Date(Date.now() + 10 * 86_400_000).toISOString(), renewing: false, credits: 0, customerId: "cus_1" });
    const browser = await (await call(`${ORIGIN}/edit/wax?k=${KEY}`)).text();
    expect(browser).toContain("/api/billing/checkout");
    expect(browser).toContain("/api/billing/portal");

    for (const headers of [{ cookie: "sv_app=1" }, { referer: `${APP_REFERRER}/` }] as Record<string, string>[]) {
      const res = await call(`${ORIGIN}/edit/wax?k=${KEY}`, { headers });
      expect(res.status).toBe(200);
      const body = await res.text();
      noPayment(body);
      expect(body).toContain(MSG);
      expect(body).toContain('id="builder"'); // the free editor still works
    }
  });

  it("pending site: no publish button in the app", async () => {
    await seed("wax", initialBilling("web", ON, new Date())!);
    const body = await (await call(`${ORIGIN}/edit/wax?k=${KEY}`, { headers: { cookie: "sv_app=1" } })).text();
    noPayment(body);
    expect(body).toContain(MSG);
  });

  it("checkout and portal POSTs are refused from the app", async () => {
    await seed("wax", initialBilling("web", ON, new Date())!);
    for (const path of ["/api/billing/checkout", "/api/billing/portal"]) {
      const form = new FormData();
      form.set("slug", "wax");
      form.set("key", KEY);
      form.set("kind", "publish_basic");
      const res = await call(`${ORIGIN}${path}`, { method: "POST", body: form, headers: { cookie: "sv_app=1", origin: ORIGIN } });
      expect(res.status).toBe(403);
      expect(res.headers.get("location")).toBeNull();
      const body = await res.text();
      expect(body).toContain("data-app-blocked");
      expect(body).toContain(MSG);
    }
  });

  it("embed mode is untouched by the app cookie", async () => {
    const res = await call(`${ORIGIN}/edit/wax?embed=1`, { headers: { cookie: "sv_app=1" } });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).not.toContain("data-sv-app");
  });
});
