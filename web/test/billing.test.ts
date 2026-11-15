import { describe, expect, it } from "vitest";
import {
  applyEvent,
  billingConfig,
  billingOf,
  checkoutItems,
  checkoutParams,
  checkoutProblem,
  countsVisits,
  effectivePaidUntil,
  eventFromStripe,
  festiveFor,
  festiveOpen,
  initialBilling,
  offerSpend,
  planPrices,
  siteState,
  statsVisible,
  type Billing,
  type BillingConfig,
} from "../src/billing.js";

const ON: BillingConfig = { on: true, earlyAccessUntil: "2027-01-31" };
const OFF: BillingConfig = { on: false, earlyAccessUntil: "2027-01-31" };
const NOW = new Date("2026-12-01T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const active = (over: Partial<Billing> = {}): Billing => ({
  status: "active",
  plan: "basic",
  buildPaid: true,
  paidUntil: day(10).toISOString(),
  renewing: true,
  credits: 2,
  ...over,
});

describe("billingConfig", () => {
  it("is off unless BILLING is exactly on", () => {
    expect(billingConfig({}).on).toBe(false);
    expect(billingConfig({ BILLING: "off" }).on).toBe(false);
    expect(billingConfig({ BILLING: "ON" }).on).toBe(false);
    expect(billingConfig({ BILLING: "on" }).on).toBe(true);
  });
  it("ignores an unparseable early-access date", () => {
    expect(billingConfig({ EARLY_ACCESS_UNTIL: "soon" }).earlyAccessUntil).toBeNull();
    expect(billingConfig({ EARLY_ACCESS_UNTIL: "2027-01-31" }).earlyAccessUntil).toBe("2027-01-31");
  });
});

describe("prices", () => {
  it("follow the decided table", () => {
    expect(planPrices("web")).toEqual({ basic: 49, pro: 89, festive: false });
    expect(planPrices("web", true)).toEqual({ basic: 29, pro: 59, festive: true });
    expect(planPrices("advault")).toEqual({ basic: null, pro: 49, festive: false });
    expect(planPrices("advault", true)).toEqual({ basic: null, pro: 49, festive: false });
  });
});

describe("initialBilling", () => {
  it("stores nothing while BILLING is off (counts as early access later)", () => {
    expect(initialBilling("web", OFF, NOW)).toBeUndefined();
    expect(initialBilling("advault", OFF, NOW)).toBeUndefined();
  });
  it("SiteVault-made sites wait for payment, with 2 credits", () => {
    expect(initialBilling("web", ON, NOW)).toEqual({ status: "pending", plan: "basic", buildPaid: false, paidUntil: null, renewing: false, credits: 2 });
  });
  it("AdVault-made sites are published with a first year of Pro (the $10 paid in AdVault)", () => {
    const b = initialBilling("advault", ON, NOW)!;
    expect(b.status).toBe("active");
    expect(b.plan).toBe("pro");
    expect(b.buildPaid).toBe(true);
    expect(b.credits).toBe(2);
    expect(b.paidUntil).toBe(day(365).toISOString());
  });
});

describe("siteState", () => {
  it("is always live while BILLING is off", () => {
    expect(siteState({ billing: initialBilling("web", ON, NOW) }, OFF, NOW)).toBe("live");
    expect(siteState({ billing: active({ paidUntil: day(-100).toISOString() }) }, OFF, NOW)).toBe("live");
  });
  it("pending sites are unpublished", () => {
    expect(siteState({ billing: initialBilling("web", ON, NOW) }, ON, NOW)).toBe("unpublished");
  });
  it("live until paidUntil, then 14 days grace, then paused", () => {
    expect(siteState({ billing: active({ paidUntil: day(1).toISOString() }) }, ON, NOW)).toBe("live");
    expect(siteState({ billing: active({ paidUntil: NOW.toISOString() }) }, ON, NOW)).toBe("live");
    expect(siteState({ billing: active({ paidUntil: day(-1).toISOString() }) }, ON, NOW)).toBe("grace");
    expect(siteState({ billing: active({ paidUntil: day(-14).toISOString() }) }, ON, NOW)).toBe("grace");
    expect(siteState({ billing: active({ paidUntil: day(-15).toISOString() }) }, ON, NOW)).toBe("paused");
  });
  it("sites made before billing count as paid until the end of EARLY_ACCESS_UNTIL", () => {
    const legacy = {};
    expect(siteState(legacy, ON, new Date("2027-01-31T23:59:00Z"))).toBe("live");
    expect(siteState(legacy, ON, new Date("2027-02-01T00:01:00Z"))).toBe("grace");
    expect(siteState(legacy, ON, new Date("2027-02-16T00:01:00Z"))).toBe("paused");
    expect(siteState(legacy, { on: true, earlyAccessUntil: null }, NOW)).toBe("live");
  });
  it("early-access sites that paid keep the later of the two dates", () => {
    const b = { ...billingOf({}), paidUntil: "2027-12-01T00:00:00Z" };
    expect(effectivePaidUntil(b, ON)?.toISOString()).toBe("2027-12-01T00:00:00.000Z");
    expect(siteState({ billing: b }, ON, new Date("2027-06-01T00:00:00Z"))).toBe("live");
  });
  it("paused never means deleted: paying restores at once", () => {
    const paused = { billing: active({ paidUntil: day(-60).toISOString(), renewing: false, subscriptionId: "sub_old" }) };
    expect(siteState(paused, ON, NOW)).toBe("paused");
    const { billing } = applyEvent(paused.billing, { type: "checkout_completed", slug: "s", kind: "renew_basic", customerId: "cus_1", subscriptionId: "sub_new", email: null }, NOW);
    expect(siteState({ billing }, ON, NOW)).toBe("live");
  });
});

describe("stats visibility and counting", () => {
  it("everyone sees stats while BILLING is off", () => {
    expect(statsVisible({ billing: active({ plan: "basic" }) }, OFF, NOW)).toBe(true);
  });
  it("only Pro sees the breakdown, and not when paused", () => {
    expect(statsVisible({ billing: active({ plan: "pro" }) }, ON, NOW)).toBe(true);
    expect(statsVisible({ billing: active({ plan: "basic" }) }, ON, NOW)).toBe(false);
    expect(statsVisible({ billing: active({ plan: "pro", paidUntil: day(-30).toISOString() }) }, ON, NOW)).toBe(false);
    expect(statsVisible({}, ON, NOW)).toBe(true); // early access
  });
  it("visits count only while the real site shows", () => {
    expect(countsVisits({ billing: initialBilling("web", ON, NOW) }, ON, NOW)).toBe(false);
    expect(countsVisits({ billing: active({ paidUntil: day(-5).toISOString() }) }, ON, NOW)).toBe(true);
    expect(countsVisits({ billing: active({ paidUntil: day(-30).toISOString() }) }, ON, NOW)).toBe(false);
  });
});

describe("offerSpend", () => {
  it("is free while BILLING is off", () => {
    expect(offerSpend("a", "b", 0, false)).toEqual({ ok: true, spend: 0 });
  });
  it("a new, different, non-empty offer costs 1 credit", () => {
    expect(offerSpend(null, "Spring sale", 2, true)).toEqual({ ok: true, spend: 1 });
    expect(offerSpend("Spring sale", "Summer sale", 1, true)).toEqual({ ok: true, spend: 1 });
  });
  it("unchanged or cleared is free", () => {
    expect(offerSpend("Spring sale", "Spring sale", 0, true)).toEqual({ ok: true, spend: 0 });
    expect(offerSpend("Spring sale", " Spring sale ", 0, true)).toEqual({ ok: true, spend: 0 });
    expect(offerSpend("Spring sale", null, 0, true)).toEqual({ ok: true, spend: 0 });
    expect(offerSpend("Spring sale", "", 0, true)).toEqual({ ok: true, spend: 0 });
  });
  it("is refused with no credits", () => {
    expect(offerSpend("a", "b", 0, true)).toEqual({ ok: false });
  });
});

describe("checkout", () => {
  const pending = initialBilling("web", ON, NOW)!;
  const prices = { BASIC: "price_basic", BASIC_FESTIVE: "price_festive", PRO: "price_pro", PRO_FESTIVE: "price_pro_festive", PRO_ADVAULT: "price_pro_av", CREDITS: "price_credits" };

  it("refuses unknown kinds, Basic for AdVault sites, and a duplicate renewing plan", () => {
    expect(checkoutProblem("free_stuff", "web", pending)).not.toBeNull();
    expect(checkoutProblem("publish_basic", "advault", active({ plan: "pro" }))).not.toBeNull();
    expect(checkoutProblem("renew_basic", "web", active({ plan: "basic", renewing: true }))).not.toBeNull();
    expect(checkoutProblem("renew_pro", "web", active({ plan: "basic", renewing: true }))).toBeNull(); // upgrade
    expect(checkoutProblem("renew_basic", "web", active({ plan: "basic", renewing: false }))).toBeNull();
    expect(checkoutProblem("credits", "advault", active())).toBeNull();
  });

  it("charges one yearly price, no build fee; festive for both plans, never AdVault", () => {
    expect(checkoutItems("publish_basic", "web")).toEqual({ mode: "subscription", prices: ["BASIC"] });
    expect(checkoutItems("publish_basic", "web", true)).toEqual({ mode: "subscription", prices: ["BASIC_FESTIVE"] });
    expect(checkoutItems("renew_basic", "web", true)).toEqual({ mode: "subscription", prices: ["BASIC_FESTIVE"] });
    expect(checkoutItems("publish_pro", "web", true)).toEqual({ mode: "subscription", prices: ["PRO_FESTIVE"] });
    expect(checkoutItems("publish_pro", "web")).toEqual({ mode: "subscription", prices: ["PRO"] });
    expect(checkoutItems("renew_pro", "advault", true)).toEqual({ mode: "subscription", prices: ["PRO_ADVAULT"] });
    expect(checkoutItems("credits", "web", true)).toEqual({ mode: "payment", prices: ["CREDITS"] });
  });

  it("tags a festive checkout so the webhook can lock the price", () => {
    const r = checkoutParams({ kind: "publish_basic", slug: "b", source: "web", billing: pending, prices, returnUrl: "https://sv.test/e", festive: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = new Map(r.params);
    expect(p.get("line_items[0][price]")).toBe("price_festive");
    expect(p.has("line_items[1][price]")).toBe(false);
    expect(p.get("metadata[festive]")).toBe("1");
    expect(p.get("subscription_data[metadata][festive]")).toBe("1");
    const pro = checkoutParams({ kind: "publish_pro", slug: "b", source: "web", billing: pending, prices, returnUrl: "https://sv.test/e", festive: true });
    expect(pro.ok && new Map(pro.params).get("line_items[0][price]")).toBe("price_pro_festive");
    expect(pro.ok && new Map(pro.params).get("metadata[festive]")).toBe("1");
    const av = checkoutParams({ kind: "renew_pro", slug: "b", source: "advault", billing: pending, prices, returnUrl: "https://sv.test/e", festive: true });
    expect(av.ok && new Map(av.params).has("metadata[festive]")).toBe(false);
  });

  it("tags everything with metadata.app = sitevault", () => {
    const r = checkoutParams({ kind: "publish_pro", slug: "bellas", source: "web", billing: pending, prices, returnUrl: "https://sv.test/edit/bellas?k=abc" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = new Map(r.params);
    expect(p.get("mode")).toBe("subscription");
    expect(p.get("line_items[0][price]")).toBe("price_pro");
    expect(p.has("line_items[1][price]")).toBe(false);
    expect(p.get("metadata[app]")).toBe("sitevault");
    expect(p.get("metadata[slug]")).toBe("bellas");
    expect(p.get("metadata[kind]")).toBe("publish_pro");
    expect(p.get("subscription_data[metadata][app]")).toBe("sitevault");
    expect(p.get("subscription_data[metadata][slug]")).toBe("bellas");
    expect(p.get("subscription_data[metadata][plan]")).toBe("pro");
    expect(p.get("client_reference_id")).toBe("bellas");
    expect(p.get("success_url")).toBe("https://sv.test/edit/bellas?k=abc&paid=1");
    expect(p.get("cancel_url")).toBe("https://sv.test/edit/bellas?k=abc");
    expect(p.has("customer")).toBe(false);
  });

  it("reuses the Stripe customer; credit packs are one-time payments", () => {
    const r = checkoutParams({ kind: "credits", slug: "bellas", source: "web", billing: active({ customerId: "cus_9" }), prices, returnUrl: "https://sv.test/e" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = new Map(r.params);
    expect(p.get("mode")).toBe("payment");
    expect(p.get("line_items[0][price]")).toBe("price_credits");
    expect(p.get("customer")).toBe("cus_9");
    expect(p.get("metadata[app]")).toBe("sitevault");
    expect(p.has("subscription_data[metadata][app]")).toBe(false);
  });

  it("reports a missing price id instead of a half-built checkout", () => {
    const r = checkoutParams({ kind: "publish_basic", slug: "b", source: "web", billing: pending, prices: { BASIC: "price_basic" }, returnUrl: "https://sv.test/e", festive: true });
    expect(r).toEqual({ ok: false, missing: "BASIC_FESTIVE" });
  });
});

describe("eventFromStripe", () => {
  const session = (meta: Record<string, string>, extra: Record<string, unknown> = {}) => ({
    id: "evt_1",
    type: "checkout.session.completed",
    data: { object: { metadata: meta, payment_status: "paid", customer: "cus_1", subscription: "sub_1", customer_details: { email: "o@x.test" }, ...extra } },
  });

  it("ignores other apps' events on the shared account", () => {
    expect(eventFromStripe(session({ app: "advault", slug: "x", kind: "credits" }))).toBeNull();
    expect(eventFromStripe(session({ slug: "x", kind: "credits" }))).toBeNull();
    expect(eventFromStripe({ type: "invoice.paid", data: { object: { lines: { data: [] } } } })).toBeNull();
    expect(eventFromStripe({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", metadata: { app: "transitvault" } } } })).toBeNull();
    expect(eventFromStripe({ type: "charge.refunded", data: { object: { metadata: { app: "sitevault" } } } })).toBeNull();
  });

  it("reads a completed checkout", () => {
    expect(eventFromStripe(session({ app: "sitevault", slug: "bellas", kind: "publish_pro" }))).toEqual({
      type: "checkout_completed",
      slug: "bellas",
      kind: "publish_pro",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      email: "o@x.test",
    });
  });

  it("ignores an unpaid checkout and unknown kinds", () => {
    expect(eventFromStripe(session({ app: "sitevault", slug: "b", kind: "credits" }, { payment_status: "unpaid" }))).toBeNull();
    expect(eventFromStripe(session({ app: "sitevault", slug: "b", kind: "everything" }))).toBeNull();
  });

  it("reads invoice.paid, taking the subscription line's period end (not the one-time build line)", () => {
    const inv = {
      type: "invoice.paid",
      data: {
        object: {
          parent: { subscription_details: { subscription: "sub_1", metadata: { app: "sitevault", slug: "bellas", plan: "pro" } } },
          lines: {
            data: [
              { period: { start: 1764590400, end: 1764590400 } },
              { period: { start: 1764590400, end: 1796126400 } },
            ],
          },
        },
      },
    };
    expect(eventFromStripe(inv)).toEqual({ type: "invoice_paid", slug: "bellas", subscriptionId: "sub_1", periodEnd: 1796126400, plan: "pro" });
  });

  it("reads invoice.paid in the older shape too", () => {
    const inv = {
      type: "invoice.paid",
      data: { object: { subscription: "sub_2", subscription_details: { metadata: { app: "sitevault", slug: "b" } }, lines: { data: [{ period: { end: 1796126400 } }] } } },
    };
    expect(eventFromStripe(inv)).toMatchObject({ subscriptionId: "sub_2", slug: "b", plan: null });
  });

  it("reads subscription deletion", () => {
    expect(eventFromStripe({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", metadata: { app: "sitevault", slug: "b" } } } })).toEqual({
      type: "subscription_deleted",
      slug: "b",
      subscriptionId: "sub_1",
    });
  });
});

describe("applyEvent", () => {
  const pending = initialBilling("web", ON, NOW)!;
  const done = (kind: "publish_basic" | "publish_pro" | "renew_basic" | "renew_pro" | "credits", subscriptionId: string | null = "sub_1") =>
    ({ type: "checkout_completed", slug: "b", kind, customerId: "cus_1", subscriptionId, email: "o@x.test" }) as const;

  it("publishing activates the site, marks the build paid and stores Stripe ids", () => {
    const { billing, cancel } = applyEvent(pending, done("publish_pro"), NOW);
    expect(billing).toMatchObject({ status: "active", plan: "pro", buildPaid: true, renewing: true, customerId: "cus_1", subscriptionId: "sub_1", ownerEmail: "o@x.test", credits: 2 });
    expect(billing.paidUntil).toBe(day(365).toISOString());
    expect(cancel).toBeNull();
    expect(siteState({ billing }, ON, NOW)).toBe("live");
  });

  it("a credit pack adds 5 credits and changes nothing else", () => {
    const before = active({ credits: 0 });
    const { billing } = applyEvent(before, done("credits", null), NOW);
    expect(billing.credits).toBe(5);
    expect(billing.plan).toBe(before.plan);
    expect(billing.paidUntil).toBe(before.paidUntil);
  });

  it("an upgrade cancels the replaced subscription", () => {
    const basic = active({ plan: "basic", subscriptionId: "sub_basic", renewing: true });
    const { billing, cancel } = applyEvent(basic, done("renew_pro", "sub_pro"), NOW);
    expect(billing.plan).toBe("pro");
    expect(billing.subscriptionId).toBe("sub_pro");
    expect(cancel).toBe("sub_basic");
  });

  it("never shortens time already paid for", () => {
    const later = day(500).toISOString();
    const { billing } = applyEvent(active({ paidUntil: later }), done("renew_basic", "sub_9"), NOW);
    expect(billing.paidUntil).toBe(later);
  });

  it("invoice.paid extends paidUntil to the period end", () => {
    const b = active({ subscriptionId: "sub_1", paidUntil: day(5).toISOString() });
    const end = Math.floor(day(370).getTime() / 1000);
    const { billing } = applyEvent(b, { type: "invoice_paid", slug: "b", subscriptionId: "sub_1", periodEnd: end, plan: "basic" }, NOW);
    expect(billing.paidUntil).toBe(new Date(end * 1000).toISOString());
  });

  it("invoice.paid arriving before checkout.session.completed still publishes", () => {
    const end = Math.floor(day(365).getTime() / 1000);
    const { billing } = applyEvent(pending, { type: "invoice_paid", slug: "b", subscriptionId: "sub_1", periodEnd: end, plan: "pro" }, NOW);
    expect(billing).toMatchObject({ status: "active", plan: "pro", buildPaid: true, subscriptionId: "sub_1", renewing: true });
  });

  it("an old subscription's invoice doesn't change the current plan", () => {
    const b = active({ plan: "pro", subscriptionId: "sub_pro" });
    const { billing } = applyEvent(b, { type: "invoice_paid", slug: "b", subscriptionId: "sub_basic", periodEnd: null, plan: "basic" }, NOW);
    expect(billing.plan).toBe("pro");
    expect(billing.subscriptionId).toBe("sub_pro");
  });

  it("subscription deleted stops renewing; the paid time is kept", () => {
    const b = active({ subscriptionId: "sub_1", renewing: true });
    const { billing } = applyEvent(b, { type: "subscription_deleted", slug: "b", subscriptionId: "sub_1" }, NOW);
    expect(billing.renewing).toBe(false);
    expect(billing.paidUntil).toBe(b.paidUntil);
    expect(siteState({ billing }, ON, NOW)).toBe("live");
  });

  it("deleting a replaced subscription leaves the new one renewing", () => {
    const b = active({ subscriptionId: "sub_pro", renewing: true });
    expect(applyEvent(b, { type: "subscription_deleted", slug: "b", subscriptionId: "sub_basic" }, NOW).billing.renewing).toBe(true);
  });

  it("a festive checkout locks $29 for life, through plan switches", () => {
    const { billing } = applyEvent(pending, { ...done("publish_basic"), festive: true }, NOW);
    expect(billing.festive).toBe(true);
    const after = applyEvent(billing, done("renew_pro", "sub_2"), NOW).billing;
    expect(after.festive).toBe(true);
    expect(applyEvent(pending, done("publish_basic"), NOW).billing.festive).toBeUndefined();
  });

  it("works on sites made before billing (early access record)", () => {
    const { billing } = applyEvent(billingOf({}), done("renew_basic"), NOW);
    expect(billing).toMatchObject({ status: "active", plan: "basic", earlyAccess: true, buildPaid: true });
  });
});

import { billingSection, donePage, termsPage, visitorsSection } from "../src/pages.js";

describe("billing UI", () => {
  const view = (b: Billing, source: "web" | "advault" = "web") => ({
    state: siteState({ billing: b }, ON, NOW),
    billing: b,
    source,
    prices: planPrices(source, festiveFor(b, ON, NOW)),
    paidUntil: effectivePaidUntil(b, ON),
    justPaid: false,
  });

  it("an unpublished site offers both publish options, no build fee", () => {
    const h = billingSection("bellas", "k&y", view(initialBilling("web", ON, NOW)!));
    expect(h).toContain("Publish: $49/year");
    expect(h).toContain("Publish with Pro: $89/year");
    expect(h).not.toContain("Festive");
    expect(h).toContain('value="publish_basic"');
    expect(h).toContain('value="k&amp;y"');
    expect(h).toContain("Buy 5 offer credits for $10");
    expect(h).not.toContain("Manage billing");
  });

  it("an AdVault site is offered Pro at $49 and never Basic", () => {
    const h = billingSection("b", "k", view(initialBilling("advault", ON, NOW)!, "advault"));
    expect(h).toContain("Pro: Pay $49/year");
    expect(h).not.toContain("renew_basic");
  });

  it("a renewing Basic site can upgrade and manage billing", () => {
    const h = billingSection("b", "k", view(active({ customerId: "cus_1" })));
    expect(h).toContain("Upgrade to Pro: $89/year");
    expect(h).toContain("Manage billing");
    expect(h).not.toContain('value="renew_basic"');
  });

  it("the done page shows Publish buttons only when the site waits for payment", () => {
    expect(donePage({ siteUrl: "https://a/", editUrl: "https://e/", nonce: "n" })).not.toContain("/api/billing/checkout");
    const d = donePage({ siteUrl: "https://a/", editUrl: "https://e/", nonce: "n", publish: { slug: "a", key: "k", prices: planPrices("web") } });
    expect(d).toContain("Publish: $49/year");
    const f = donePage({ siteUrl: "https://a/", editUrl: "https://e/", nonce: "n", publish: { slug: "a", key: "k", prices: planPrices("web", true) } });
    expect(f).toContain("Publish: $29/year");
    expect(f).toContain("Publish with Pro: $59/year");
    expect(f).toContain("Festive season prices (price locked for life)");
    expect(d).toContain("https://e/");
  });

  it("Basic sees the total and an upgrade prompt; Pro sees the breakdown", () => {
    const stats = {
      total: 3,
      days: [{ day: "2026-11-30", views: 3 }],
      sources: [{ source: "youtube", views: 2 }],
      places: [{ city: "<Secaucus>", country: "US", views: 3 }],
      devices: [{ device: "mobile", views: 3 }],
      taps: { calls: 1, directions: 0, offer: 0 },
    };
    const basic = visitorsSection({ stats, full: false });
    expect(basic).toContain("<strong>3</strong> visits");
    expect(basic).toContain("Upgrade to Pro");
    expect(basic).not.toContain("YouTube");
    const pro = visitorsSection({ stats, full: true });
    expect(pro).toContain("YouTube");
    expect(pro).toContain("&lt;Secaucus&gt;, US");
    expect(pro).toContain("Taps to call");
  });

  it("terms describe the decided prices", () => {
    const t = termsPage();
    for (const s of ["$49 a year", "$89 a year", "$29 a year", "$59 a year", "January 31, 2027", "$10 one-time", "Pro at $49 a year", "$10 for 5", "14 days"]) expect(t).toContain(s);
    expect(t).not.toContain("$5 one-time");
  });
});

describe("festive season price", () => {
  const F = { on: true, earlyAccessUntil: "2027-01-31", festiveUntil: "2027-01-31" };
  it("is open through the end of its last day (UTC), then closes", () => {
    expect(festiveOpen(F, new Date("2027-01-31T23:59:59Z"))).toBe(true);
    expect(festiveOpen(F, new Date("2027-02-01T00:00:00Z"))).toBe(false);
    expect(festiveOpen(ON, NOW)).toBe(false);
  });
  it("stays on a site that locked it in", () => {
    const late = new Date("2028-06-01T00:00:00Z");
    expect(festiveFor(active({ festive: true }), F, late)).toBe(true);
    expect(festiveFor(active(), F, late)).toBe(false);
  });
  it("is read from FESTIVE_UNTIL", () => {
    expect(billingConfig({ FESTIVE_UNTIL: "2027-01-31" }).festiveUntil).toBe("2027-01-31");
    expect(billingConfig({ FESTIVE_UNTIL: "nope" }).festiveUntil).toBeNull();
  });
});

import { applyAdvaultPaid } from "../src/billing.js";

describe("AdVault-paid websites", () => {
  it("wait unpublished until AdVault reports the $10", () => {
    const b = initialBilling("advault", ON, NOW, true)!;
    expect(b).toMatchObject({ status: "pending", plan: "pro", paidUntil: null });
    expect(siteState({ billing: b }, ON, NOW)).toBe("unpublished");
    expect(initialBilling("advault", OFF, NOW, true)).toBeUndefined();
  });
  it("publish with a year of Pro once paid, never shortening paid time", () => {
    const paid = applyAdvaultPaid(initialBilling("advault", ON, NOW, true)!, NOW);
    expect(paid).toMatchObject({ status: "active", plan: "pro", buildPaid: true, paidUntil: day(365).toISOString() });
    expect(siteState({ billing: paid }, ON, NOW)).toBe("live");
    const far = day(900).toISOString();
    expect(applyAdvaultPaid({ ...paid, paidUntil: far }, NOW).paidUntil).toBe(far);
  });
  it("the edit page sends an unpaid AdVault site back to AdVault", () => {
    const b = initialBilling("advault", ON, NOW, true)!;
    const h = billingSection("b", "k", { state: "unpublished", billing: b, source: "advault", prices: planPrices("advault"), paidUntil: null, justPaid: false });
    expect(h).toContain("Finish in AdVault");
    expect(h).not.toContain("publish_pro");
  });
});
