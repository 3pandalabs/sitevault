// Paid plans: the pure decisions. No fetch, no KV, no Stripe calls here (see
// stripe.ts and index.ts), so every rule below is unit-tested.
//
// Pricing (owner's decision, revised 2026-11-15):
//                    Made on SiteVault           Made from AdVault
//   Build            free (pay when you publish) $10 in AdVault, first year of Pro included
//   Basic            $49/year                    not offered
//   Festive prices   Basic $29/year, Pro $59/year, -
//                    locked for life, if paid before FESTIVE_UNTIL
//   Pro (stats)      $89/year                    Included while the AdVault plan runs
//                                               (applyPlanCover); else $49/year from year two
//   Offer change     1 credit                    1 credit
// Every new site starts with 2 credits; a pack is 5 credits for $10.
// "Locked for life": the Stripe subscription keeps the $29 price, and
// billing.festive keeps a lapsed or switching site on festive prices.
// Unpaid: 14 days' grace after paidUntil, then a "paused" page. Never delete.
//
// Everything is behind BILLING ("off" by default). Off = everything free,
// exactly as before paid plans existed.

export type Plan = "basic" | "pro";
export type Source = "web" | "advault";

export type Billing = {
  /** pending = made on SiteVault and not yet paid for (unpublished). */
  status: "pending" | "active";
  plan: Plan;
  /** Published at least once (the old $5 build fee is gone; kept for stored records). */
  buildPaid: boolean;
  /** ISO time the paid period ends; null while pending. */
  paidUntil: string | null;
  /** A live Stripe subscription will renew it. */
  renewing: boolean;
  credits: number;
  /** Created before billing started: paid until EARLY_ACCESS_UNTIL. */
  earlyAccess?: boolean;
  /** Comped by a 3PandaLabs admin: publishes free, never pending or paused, no expiry. */
  comp?: boolean;
  /** Paid at a festive price: Basic $29 / Pro $59 a year for life. */
  festive?: boolean;
  /** AdVault-made: the AdVault plan covers Pro until this ISO time (the plan's paid period). */
  planCoveredUntil?: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  ownerEmail?: string | null;
};

export type BillingConfig = { on: boolean; earlyAccessUntil: string | null; festiveUntil?: string | null };

export type CheckoutKind = "publish_basic" | "publish_pro" | "renew_basic" | "renew_pro" | "credits";
export const CHECKOUT_KINDS: CheckoutKind[] = ["publish_basic", "publish_pro", "renew_basic", "renew_pro", "credits"];

export type PriceKey = "BASIC" | "BASIC_FESTIVE" | "PRO" | "PRO_FESTIVE" | "PRO_ADVAULT" | "CREDITS";
export type PriceIds = Partial<Record<PriceKey, string>>;

export const START_CREDITS = 2;
export const PACK_CREDITS = 5;
export const GRACE_DAYS = 14;
/** The first year of an AdVault-made site is covered by the $10 paid in AdVault. */
export const ADVAULT_INCLUDED_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Appended to the shared Stripe account's `3PANDALABS` prefix so card
 * statements read `3PANDALABS* SITEVAULT`. Stripe caps prefix + "* " + suffix
 * at 22 chars (so 10 here), letters/digits/spaces only. One-time payments
 * only: Stripe rejects `payment_intent_data` on subscription-mode Checkout, so
 * subscriptions show the plain account descriptor.
 */
export const STATEMENT_DESCRIPTOR_SUFFIX = "SITEVAULT";

/** Dollar amounts for display. Stripe prices hold the real amounts. */
export const DOLLARS = { basic: 49, festive: 29, pro: 89, festivePro: 59, proAdvault: 49, advaultSetup: 10, advaultAd: 10, pack: 10 } as const;

const validDate = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? v : null);

/** End of a YYYY-MM-DD day (UTC), or the exact time for a full timestamp. */
export function endOf(date: string): Date {
  return new Date(new Date(date).getTime() + (date.length <= 10 ? DAY_MS - 1 : 0));
}

/** The festive offer is open (Basic $29 / Pro $59 a year, locked for life). */
export function festiveOpen(cfg: BillingConfig, now: Date): boolean {
  return Boolean(cfg.festiveUntil) && now.getTime() <= endOf(cfg.festiveUntil!).getTime();
}

/** This site pays festive prices: the offer is open, or it locked them in. */
export function festiveFor(b: Billing | undefined, cfg: BillingConfig, now: Date): boolean {
  return Boolean(b?.festive) || festiveOpen(cfg, now);
}

export function billingConfig(env: { BILLING?: string; EARLY_ACCESS_UNTIL?: string; FESTIVE_UNTIL?: string }): BillingConfig {
  return { on: env.BILLING === "on", earlyAccessUntil: validDate(env.EARLY_ACCESS_UNTIL), festiveUntil: validDate(env.FESTIVE_UNTIL) };
}

export type PlanPrices = { basic: number | null; pro: number; festive: boolean };

/** What a site pays per year, by where it was made. Basic is null when not offered. */
export function planPrices(source: Source, festive = false): PlanPrices {
  return source === "advault"
    ? { basic: null, pro: DOLLARS.proAdvault, festive: false }
    : { basic: festive ? DOLLARS.festive : DOLLARS.basic, pro: festive ? DOLLARS.festivePro : DOLLARS.pro, festive };
}

/**
 * Billing for a brand-new site, or undefined while BILLING is off (so the site counts as early access later).
 * `awaitingPayment` (AdVault-made only): the site waits unpublished until AdVault reports its $10 paid
 * (POST /api/internal/sites/<slug>/paid, applyAdvaultPaid).
 */
export function initialBilling(source: Source, cfg: BillingConfig, now: Date, awaitingPayment = false): Billing | undefined {
  if (!cfg.on) return undefined;
  if (source === "advault" && awaitingPayment) {
    return { status: "pending", plan: "pro", buildPaid: false, paidUntil: null, renewing: false, credits: START_CREDITS };
  }
  if (source === "advault") {
    // Published at once with a year of Pro (the $10 paid in AdVault), then Pro at the AdVault price.
    return {
      status: "active",
      plan: "pro",
      buildPaid: true,
      paidUntil: new Date(now.getTime() + ADVAULT_INCLUDED_DAYS * DAY_MS).toISOString(),
      renewing: false,
      credits: START_CREDITS,
    };
  }
  return { status: "pending", plan: "basic", buildPaid: false, paidUntil: null, renewing: false, credits: START_CREDITS };
}

/** A comped site (owner is a 3PandaLabs admin): active, free, never expires. */
export function compBilling(): Billing {
  return { status: "active", plan: "pro", buildPaid: true, paidUntil: null, renewing: false, credits: START_CREDITS, comp: true };
}

/** AdVault took the $10: publish with a year of Pro. Never shortens time already paid for. */
export function applyAdvaultPaid(b: Billing, now: Date): Billing {
  return {
    ...b,
    status: "active",
    plan: "pro",
    buildPaid: true,
    paidUntil: later(b.paidUntil, new Date(now.getTime() + ADVAULT_INCLUDED_DAYS * DAY_MS).toISOString()),
  };
}

/** Longest cover one push may grant: a month's plan period plus slack. */
export const MAX_PLAN_COVER_DAYS = 45;

/** A plan-cover end date AdVault may send: in the future, at most MAX_PLAN_COVER_DAYS away. null = refuse. */
export function planCoverUntil(value: unknown, now: Date): Date | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) && t > now.getTime() && t <= now.getTime() + MAX_PLAN_COVER_DAYS * DAY_MS ? new Date(t) : null;
}

/**
 * The AdVault plan is running: Pro is paid to the end of its period. Only ever
 * moves forward, so repeats and late pushes are harmless.
 */
export function applyPlanCover(b: Billing, until: Date): Billing {
  const iso = until.toISOString();
  return { ...b, plan: "pro", paidUntil: later(b.paidUntil, iso), planCoveredUntil: later(b.planCoveredUntil ?? null, iso) };
}

/** The AdVault plan is what keeps this site paid right now, so there is nothing to renew. */
export function planCovers(b: Billing, now: Date): boolean {
  const until = b.planCoveredUntil ? Date.parse(b.planCoveredUntil) : 0;
  return until > now.getTime() && (!b.paidUntil || Date.parse(b.paidUntil) <= until);
}

/** A site's billing record, defaulting sites made before billing started to early access. */
export function billingOf(site: { billing?: Billing }): Billing {
  return (
    site.billing ?? {
      status: "active",
      plan: "pro",
      buildPaid: true,
      paidUntil: null,
      renewing: false,
      credits: START_CREDITS,
      earlyAccess: true,
    }
  );
}

/** End of the paid period, counting early access. null = no end (early access with no end date set). */
export function effectivePaidUntil(b: Billing, cfg: BillingConfig): Date | null {
  const paid = b.paidUntil ? new Date(b.paidUntil) : null;
  if (!b.earlyAccess) return paid;
  // EARLY_ACCESS_UNTIL is a date: early access lasts to the end of that day (UTC).
  if (!cfg.earlyAccessUntil) return null;
  const early = endOf(cfg.earlyAccessUntil);
  return paid && paid > early ? paid : early;
}

export type SiteState = "live" | "unpublished" | "grace" | "paused";

/** Whether the public site shows, and how. BILLING off = always live. */
export function siteState(site: { billing?: Billing }, cfg: BillingConfig, now: Date): SiteState {
  if (!cfg.on) return "live";
  const b = billingOf(site);
  if (b.comp) return "live";
  if (b.status === "pending") return "unpublished";
  const until = effectivePaidUntil(b, cfg);
  if (until === null) return b.earlyAccess ? "live" : "paused";
  if (now.getTime() <= until.getTime()) return "live";
  if (now.getTime() <= until.getTime() + GRACE_DAYS * DAY_MS) return "grace";
  return "paused";
}

/** The visitor-stats breakdown is a Pro feature (everyone sees it while BILLING is off). */
export function statsVisible(site: { billing?: Billing }, cfg: BillingConfig, now: Date): boolean {
  if (!cfg.on) return true;
  const state = siteState(site, cfg, now);
  return billingOf(site).plan === "pro" && (state === "live" || state === "grace");
}

/** Visits are counted only while the real site is showing. */
export function countsVisits(site: { billing?: Billing }, cfg: BillingConfig, now: Date): boolean {
  const s = siteState(site, cfg, now);
  return s === "live" || s === "grace";
}

/**
 * Offer edits. Saving a new non-empty offer that differs from the current one
 * spends 1 credit; clearing it or leaving it unchanged is free. The offer typed
 * when the site is created is part of the build and costs nothing.
 */
export function offerSpend(
  current: string | null,
  next: string | null,
  credits: number,
  billingOn: boolean,
): { ok: true; spend: 0 | 1 } | { ok: false } {
  if (!billingOn) return { ok: true, spend: 0 };
  const n = (next ?? "").trim();
  if (!n || n === (current ?? "").trim()) return { ok: true, spend: 0 };
  return credits >= 1 ? { ok: true, spend: 1 } : { ok: false };
}

/**
 * An offer set from AdVault's offer combo (POST /api/internal/sites/<slug>/offer).
 * "advault": paid for in AdVault, no credit spent. "credit": the offer-change
 * rule above, except that with no credit left the offer is STILL set (the
 * customer chose it in good faith in AdVault) and flagged creditShort.
 */
export function internalOfferSpend(
  payment: "advault" | "credit",
  current: string | null,
  next: string,
  credits: number,
  billingOn: boolean,
): { spend: 0 | 1; creditShort: boolean } {
  if (payment === "advault") return { spend: 0, creditShort: false };
  const r = offerSpend(current, next, credits, billingOn);
  return r.ok ? { spend: r.spend, creditShort: false } : { spend: 0, creditShort: true };
}

/** How long an AdVault offer `ref` is remembered (~30 days). */
export const OFFER_REF_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Idempotency: a ref already applied replays its stored result and never spends again. */
export function offerRefDecision<T>(stored: T | null): { replay: true; result: T } | { replay: false } {
  return stored ? { replay: true, result: stored } : { replay: false };
}

/** Why this checkout can't start, or null. */
export function checkoutProblem(kind: string, source: Source, b: Billing): string | null {
  if (!CHECKOUT_KINDS.includes(kind as CheckoutKind)) return "Unknown option.";
  if (kind === "credits") return null;
  const plan: Plan = kind.endsWith("_pro") ? "pro" : "basic";
  if (plan === "basic" && source === "advault") return "Basic isn't offered for websites made from AdVault.";
  if (b.renewing && b.plan === plan) return "This plan already renews automatically. Use Manage billing to change it.";
  return null;
}

/** Stripe price and mode for a checkout. `festive`: festive prices (see festiveFor); never for AdVault-made sites. */
export function checkoutItems(kind: CheckoutKind, source: Source, festive = false): { mode: "subscription" | "payment"; prices: PriceKey[] } {
  if (kind === "credits") return { mode: "payment", prices: ["CREDITS"] };
  if (kind.endsWith("_pro")) return { mode: "subscription", prices: [source === "advault" ? "PRO_ADVAULT" : festive ? "PRO_FESTIVE" : "PRO"] };
  return { mode: "subscription", prices: [festive ? "BASIC_FESTIVE" : "BASIC"] };
}

/**
 * Form fields for POST /v1/checkout/sessions, or the missing price key.
 *
 * Upgrade Basic -> Pro (or any switch while a subscription renews): a NEW
 * Checkout for the other plan. When it completes, the webhook cancels the old
 * subscription with prorate=true, so the unused Basic time becomes credit on
 * the Stripe customer's balance and comes off their next invoice. Simpler and
 * clearer than configuring plan switching in the shared account's billing portal.
 */
export function checkoutParams(opts: {
  kind: CheckoutKind;
  slug: string;
  source: Source;
  billing: Billing;
  prices: PriceIds;
  returnUrl: string;
  /** Festive prices (see festiveFor). */
  festive?: boolean;
}): { ok: true; params: [string, string][] } | { ok: false; missing: PriceKey } {
  const { kind, slug, billing, returnUrl } = opts;
  const items = checkoutItems(kind, opts.source, opts.festive);
  const festive = items.prices[0] === "BASIC_FESTIVE" || items.prices[0] === "PRO_FESTIVE";
  const p: [string, string][] = [["mode", items.mode]];
  for (const [i, key] of items.prices.entries()) {
    const id = opts.prices[key];
    if (!id) return { ok: false, missing: key };
    p.push([`line_items[${i}][price]`, id], [`line_items[${i}][quantity]`, "1"]);
  }
  const sep = returnUrl.includes("?") ? "&" : "?";
  p.push(
    // {CHECKOUT_SESSION_ID} is substituted by Stripe: the edit page verifies the
    // session on return and publishes at once, so it doesn't wait on the webhook.
    ["success_url", `${returnUrl}${sep}paid=1&session_id={CHECKOUT_SESSION_ID}`],
    ["cancel_url", returnUrl],
    ["client_reference_id", slug],
    ["metadata[app]", "sitevault"],
    ["metadata[slug]", slug],
    ["metadata[kind]", kind],
  );
  if (festive) p.push(["metadata[festive]", "1"]);
  if (items.mode === "subscription") {
    p.push(
      ["subscription_data[metadata][app]", "sitevault"],
      ["subscription_data[metadata][slug]", slug],
      ["subscription_data[metadata][plan]", kind.endsWith("_pro") ? "pro" : "basic"],
    );
    if (festive) p.push(["subscription_data[metadata][festive]", "1"]);
  } else {
    p.push(
      ["payment_intent_data[metadata][app]", "sitevault"],
      ["payment_intent_data[metadata][slug]", slug],
      ["payment_intent_data[statement_descriptor_suffix]", STATEMENT_DESCRIPTOR_SUFFIX],
    );
  }
  if (billing.customerId) p.push(["customer", billing.customerId]);
  else if (items.mode === "payment") p.push(["customer_creation", "always"]);
  return { ok: true, params: p };
}

// ---------------------------------------------------------------------------
// Webhook events -> state changes

export type BillingEvent =
  | { type: "checkout_completed"; slug: string; kind: CheckoutKind; customerId: string | null; subscriptionId: string | null; email: string | null; festive?: boolean }
  | { type: "invoice_paid"; slug: string; subscriptionId: string | null; periodEnd: number | null; plan: Plan | null }
  | { type: "subscription_deleted"; slug: string; subscriptionId: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? str(obj(v).id);

/** Subscription metadata on an invoice: newer API versions nest it under parent. */
function invoiceMeta(inv: Obj): Obj {
  const candidates = [
    obj(obj(obj(inv.parent).subscription_details).metadata),
    obj(obj(inv.subscription_details).metadata),
    ...((obj(inv.lines).data as unknown[] | undefined) ?? []).map((l) => obj(obj(l).metadata)),
  ];
  return candidates.find((m) => m.app === "sitevault") ?? candidates[0] ?? {};
}

/**
 * A Stripe event as a SiteVault billing event, or null to ignore it. The
 * Stripe account is shared by several apps: anything not tagged
 * metadata.app = "sitevault" is not ours.
 */
export function eventFromStripe(evt: unknown): BillingEvent | null {
  const e = obj(evt);
  const o = obj(obj(e.data).object);
  if (e.type === "checkout.session.completed") {
    const m = obj(o.metadata);
    const slug = str(m.slug);
    const kind = str(m.kind) as CheckoutKind | null;
    if (m.app !== "sitevault" || !slug || !kind || !CHECKOUT_KINDS.includes(kind)) return null;
    if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") return null;
    return {
      type: "checkout_completed",
      slug,
      kind,
      customerId: idOf(o.customer),
      subscriptionId: idOf(o.subscription),
      email: str(obj(o.customer_details).email),
      ...(m.festive === "1" ? { festive: true } : {}),
    };
  }
  if (e.type === "invoice.paid") {
    const m = invoiceMeta(o);
    const slug = str(m.slug);
    if (m.app !== "sitevault" || !slug) return null;
    // The first invoice also carries the one-time build fee, whose period is
    // a single instant; the subscription line has the real period end.
    const lines = ((obj(o.lines).data as unknown[] | undefined) ?? []).map(obj);
    const ends = lines.map((l) => Number(obj(l.period).end)).filter((n) => Number.isFinite(n) && n > 0);
    const subId =
      idOf(o.subscription) ?? str(obj(obj(o.parent).subscription_details).subscription) ?? str(obj(o.subscription_details).subscription);
    const plan = m.plan === "pro" || m.plan === "basic" ? m.plan : null;
    return { type: "invoice_paid", slug, subscriptionId: subId, periodEnd: ends.length ? Math.max(...ends) : null, plan };
  }
  if (e.type === "customer.subscription.deleted") {
    const m = obj(o.metadata);
    const slug = str(m.slug);
    const id = str(o.id);
    if (m.app !== "sitevault" || !slug || !id) return null;
    return { type: "subscription_deleted", slug, subscriptionId: id };
  }
  return null;
}

/** Apply an event. `cancel` names an older subscription to cancel (a plan switch). */
export function applyEvent(current: Billing, ev: BillingEvent, now: Date): { billing: Billing; cancel: string | null } {
  const b: Billing = { ...current };
  let cancel: string | null = null;
  if (ev.type === "checkout_completed") {
    if (ev.customerId) b.customerId = ev.customerId;
    if (ev.email) b.ownerEmail = ev.email;
    if (ev.kind === "credits") {
      b.credits = (b.credits ?? 0) + PACK_CREDITS;
      return { billing: b, cancel };
    }
    const plan: Plan = ev.kind.endsWith("_pro") ? "pro" : "basic";
    if (ev.subscriptionId && b.subscriptionId && b.subscriptionId !== ev.subscriptionId && b.renewing) cancel = b.subscriptionId;
    b.status = "active";
    b.plan = plan;
    b.buildPaid = true;
    b.renewing = true;
    // Locked for life, even if they switch plans or lapse and come back.
    if (ev.festive) b.festive = true;
    if (ev.subscriptionId) b.subscriptionId = ev.subscriptionId;
    // Provisional year from today; invoice.paid sets the exact period end.
    // Never shortens time already paid for.
    b.paidUntil = later(b.paidUntil, new Date(now.getTime() + 365 * DAY_MS).toISOString());
    return { billing: b, cancel };
  }
  if (ev.type === "invoice_paid") {
    if (ev.periodEnd) b.paidUntil = later(b.paidUntil, new Date(ev.periodEnd * 1000).toISOString());
    // An invoice for the current (or a not-yet-recorded) subscription.
    if (!b.subscriptionId || b.subscriptionId === ev.subscriptionId) {
      if (ev.subscriptionId) b.subscriptionId = ev.subscriptionId;
      if (ev.plan) b.plan = ev.plan;
      // The first invoice of a SiteVault-made site carries the build fee.
      if (b.status === "pending") b.buildPaid = true;
      b.status = "active";
      b.renewing = true;
    }
    return { billing: b, cancel };
  }
  // Subscription ended: stop renewing; the site stays paid until paidUntil.
  if (b.subscriptionId === ev.subscriptionId) b.renewing = false;
  return { billing: b, cancel };
}

function later(a: string | null, b: string): string {
  return a && Date.parse(a) > Date.parse(b) ? a : b;
}
