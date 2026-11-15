// Paid plans: the pure decisions. No fetch, no KV, no Stripe calls here (see
// stripe.ts and index.ts), so every rule below is unit-tested.
//
// Pricing (owner's decision, 2026-11-15):
//                    Made on SiteVault     Made from AdVault
//   Build            $5 one-time           free
//   Basic            $15/year              not offered
//   Pro (stats)      $20/year              $15/year
//   Offer change     1 credit              1 credit
// Every new site starts with 2 credits; a pack is 5 credits for $10.
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
  /** The $5 build fee (SiteVault-made sites only). */
  buildPaid: boolean;
  /** ISO time the paid period ends; null while pending. */
  paidUntil: string | null;
  /** A live Stripe subscription will renew it. */
  renewing: boolean;
  credits: number;
  /** Created before billing started: paid until EARLY_ACCESS_UNTIL. */
  earlyAccess?: boolean;
  customerId?: string | null;
  subscriptionId?: string | null;
  ownerEmail?: string | null;
};

export type BillingConfig = { on: boolean; earlyAccessUntil: string | null };

export type CheckoutKind = "publish_basic" | "publish_pro" | "renew_basic" | "renew_pro" | "credits";
export const CHECKOUT_KINDS: CheckoutKind[] = ["publish_basic", "publish_pro", "renew_basic", "renew_pro", "credits"];

export type PriceKey = "BUILD" | "BASIC" | "PRO" | "PRO_ADVAULT" | "CREDITS";
export type PriceIds = Partial<Record<PriceKey, string>>;

export const START_CREDITS = 2;
export const PACK_CREDITS = 5;
export const GRACE_DAYS = 14;
export const ADVAULT_FREE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Dollar amounts for display. Stripe prices hold the real amounts. */
export const DOLLARS = { build: 5, basic: 15, pro: 20, proAdvault: 15, pack: 10 } as const;

export function billingConfig(env: { BILLING?: string; EARLY_ACCESS_UNTIL?: string }): BillingConfig {
  const until = env.EARLY_ACCESS_UNTIL && !Number.isNaN(Date.parse(env.EARLY_ACCESS_UNTIL)) ? env.EARLY_ACCESS_UNTIL : null;
  return { on: env.BILLING === "on", earlyAccessUntil: until };
}

/** What a site pays, by where it was made. Basic is null when not offered. */
export function planPrices(source: Source): { build: number; basic: number | null; pro: number } {
  return source === "advault"
    ? { build: 0, basic: null, pro: DOLLARS.proAdvault }
    : { build: DOLLARS.build, basic: DOLLARS.basic, pro: DOLLARS.pro };
}

/** Billing for a brand-new site, or undefined while BILLING is off (so the site counts as early access later). */
export function initialBilling(source: Source, cfg: BillingConfig, now: Date): Billing | undefined {
  if (!cfg.on) return undefined;
  if (source === "advault") {
    // Published at once; first month free, then Pro at the AdVault price.
    return {
      status: "active",
      plan: "pro",
      buildPaid: true,
      paidUntil: new Date(now.getTime() + ADVAULT_FREE_DAYS * DAY_MS).toISOString(),
      renewing: false,
      credits: START_CREDITS,
    };
  }
  return { status: "pending", plan: "basic", buildPaid: false, paidUntil: null, renewing: false, credits: START_CREDITS };
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
  const early = new Date(new Date(cfg.earlyAccessUntil).getTime() + (cfg.earlyAccessUntil.length <= 10 ? DAY_MS - 1 : 0));
  return paid && paid > early ? paid : early;
}

export type SiteState = "live" | "unpublished" | "grace" | "paused";

/** Whether the public site shows, and how. BILLING off = always live. */
export function siteState(site: { billing?: Billing }, cfg: BillingConfig, now: Date): SiteState {
  if (!cfg.on) return "live";
  const b = billingOf(site);
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

/** Why this checkout can't start, or null. */
export function checkoutProblem(kind: string, source: Source, b: Billing): string | null {
  if (!CHECKOUT_KINDS.includes(kind as CheckoutKind)) return "Unknown option.";
  if (kind === "credits") return null;
  const plan: Plan = kind.endsWith("_pro") ? "pro" : "basic";
  if (plan === "basic" && source === "advault") return "Basic isn't offered for websites made from AdVault.";
  if (b.renewing && b.plan === plan) return "This plan already renews automatically. Use Manage billing to change it.";
  return null;
}

/** Stripe prices and mode for a checkout. The build fee rides along with the first plan payment. */
export function checkoutItems(kind: CheckoutKind, source: Source, b: Billing): { mode: "subscription" | "payment"; prices: PriceKey[] } {
  if (kind === "credits") return { mode: "payment", prices: ["CREDITS"] };
  const plan: PriceKey = kind.endsWith("_pro") ? (source === "advault" ? "PRO_ADVAULT" : "PRO") : "BASIC";
  const build = source !== "advault" && !b.buildPaid;
  return { mode: "subscription", prices: build ? [plan, "BUILD"] : [plan] };
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
}): { ok: true; params: [string, string][] } | { ok: false; missing: PriceKey } {
  const { kind, slug, billing, returnUrl } = opts;
  const items = checkoutItems(kind, opts.source, billing);
  const p: [string, string][] = [["mode", items.mode]];
  for (const [i, key] of items.prices.entries()) {
    const id = opts.prices[key];
    if (!id) return { ok: false, missing: key };
    p.push([`line_items[${i}][price]`, id], [`line_items[${i}][quantity]`, "1"]);
  }
  const sep = returnUrl.includes("?") ? "&" : "?";
  p.push(
    ["success_url", `${returnUrl}${sep}paid=1`],
    ["cancel_url", returnUrl],
    ["client_reference_id", slug],
    ["metadata[app]", "sitevault"],
    ["metadata[slug]", slug],
    ["metadata[kind]", kind],
  );
  if (items.mode === "subscription") {
    p.push(
      ["subscription_data[metadata][app]", "sitevault"],
      ["subscription_data[metadata][slug]", slug],
      ["subscription_data[metadata][plan]", kind.endsWith("_pro") ? "pro" : "basic"],
    );
  } else {
    p.push(["payment_intent_data[metadata][app]", "sitevault"], ["payment_intent_data[metadata][slug]", slug]);
  }
  if (billing.customerId) p.push(["customer", billing.customerId]);
  else if (items.mode === "payment") p.push(["customer_creation", "always"]);
  return { ok: true, params: p };
}

// ---------------------------------------------------------------------------
// Webhook events -> state changes

export type BillingEvent =
  | { type: "checkout_completed"; slug: string; kind: CheckoutKind; customerId: string | null; subscriptionId: string | null; email: string | null }
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
