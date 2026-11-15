// SiteVault Worker. One Worker, no server, no database:
//   KV  SITES   site:<slug> -> Site JSON; rl:<ip>:<day> -> create counter
//   R2  PHOTOS  sites/<slug>/<rand>.<ext>
//
// Routes
//   GET  /                         home
//   GET  /new                      builder
//   POST /api/sites                create (multipart). JSON reply when Accept: json
//   GET  /s/<slug>                 the customer's site (path form, works today)
//   GET  <slug>.<SITES_DOMAIN>/    the same site on the customer-site domain,
//                                  once that domain exists (SITES_DOMAIN unset = off)
//   GET  /edit/<slug>?k=<key>      builder, prefilled
//   POST /api/sites/<slug>         update (key in the form)
//   POST /api/sites/<slug>/delete  remove (key in the form)
//   GET  /p/<key>                  photo from R2
//   GET  /privacy, /terms
//   GET  /metrics                  ops envelope for admin.3pandalabs.com (METRICS_TOKEN)
//   GET  /api/admin/sites          list (ADMIN_TOKEN)
//   POST /api/admin/sites/<slug>/remove   takedown (ADMIN_TOKEN)
//   POST /api/internal/sites       one-click create from AdVault (INTERNAL_TOKEN)
//   GET  /api/internal/sites/<slug>/offer-status   offer, credits, billing (INTERNAL_TOKEN)
//   POST /api/internal/sites/<slug>/offer          set the offer from AdVault's combo (INTERNAL_TOKEN)
//   POST /api/billing/checkout     Stripe Checkout (edit key in the form; BILLING on)
//   POST /api/billing/portal       Stripe billing portal (edit key in the form)
//   POST /webhooks/stripe          Stripe events (signature-checked; metadata.app = sitevault only)
//   POST <slug>.<SITES_DOMAIN>/t/<call|directions|offer>   tap counter (HTML ping), 204
//
// D1 STATS (optional): aggregate visit counters, see stats.ts. Writes go
// through ctx.waitUntil so a stats failure never slows or breaks a page.

import { renderHold, renderSite, type RenderContext } from "./render.js";
import { builderPage, donePage, homePage, messagePage, privacyPage, termsPage, type BillingView, type FormMode } from "./pages.js";
import {
  applyEvent,
  billingConfig,
  billingOf,
  checkoutParams,
  checkoutProblem,
  countsVisits,
  effectivePaidUntil,
  endOf,
  eventFromStripe,
  festiveFor,
  festiveOpen,
  initialBilling,
  internalOfferSpend,
  OFFER_REF_TTL_SECONDS,
  offerRefDecision,
  offerSpend,
  planPrices,
  siteState,
  statsVisible,
  type CheckoutKind,
  type PriceIds,
} from "./billing.js";
import { cancelSubscription, createCheckoutSession, createPortalSession, verifyStripeSignature } from "./stripe.js";
import { TAP_KINDS, classifySource, hitFor, isBot, isPrefetch, readStats, recordHit, tapSource, type TapKind } from "./stats.js";
import { MAX_PHOTO_BYTES, MAX_PHOTOS, PHOTO_TYPES, parseContent, parseInternalOffer, type FieldErrors, type Site, type SiteContent } from "./site.js";
import { phoneIdentity, randomKey, safeEqual, sha256Hex, slugify } from "./util.js";
import { MAX_LEN, MAX_RENAMES, addressProblem, normaliseAddress, suggestAddresses } from "./address.js";

export interface Env {
  SITES: KVNamespace;
  PHOTOS: R2Bucket;
  /** Cloudflare Images binding: shrinks uploads to web size. Optional at runtime. */
  IMAGES?: ImagesBinding;
  /** https://sitevault.3pandalabs.com */
  PUBLIC_ORIGIN: string;
  /** Customer-site domain, e.g. "3panda.site". Unset until the domain is bought. */
  SITES_DOMAIN?: string;
  METRICS_TOKEN?: string;
  ADMIN_TOKEN?: string;
  /** Shared with advault-api (SITEVAULT_INTERNAL_TOKEN) for one-click sites. */
  INTERNAL_TOKEN?: string;
  /** Sites one network address may create per day. */
  DAILY_CREATE_LIMIT?: string;
  /** Visit stats (D1 sitevault-stats). Optional: skipped silently when absent. */
  STATS?: D1Database;
  /** Paid plans switch: "on" or anything else (off). */
  BILLING?: string;
  /** ISO date: sites made before billing started are paid until then. */
  EARLY_ACCESS_UNTIL?: string;
  /** ISO date: Basic paid on or before this day is $29/year for life (festive season price). */
  FESTIVE_UNTIL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_BASIC?: string;
  STRIPE_PRICE_BASIC_FESTIVE?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_PRO_ADVAULT?: string;
  STRIPE_PRICE_CREDITS?: string;
}

const bootedAt = Date.now();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      console.error("unhandled", err instanceof Error ? err.stack : err);
      return html(messagePage("Something went wrong", "Please try again in a minute.", "Error"), 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Customer-site domain (3pandasite.com since 2026-11-15). Each business has
  // its own subdomain, which Google Ads' destination rules want (shared
  // hosting without a per-site subdomain gets flagged). The bare domain and
  // www go to SiteVault's home page.
  if (env.SITES_DOMAIN && (url.hostname === env.SITES_DOMAIN || url.hostname === `www.${env.SITES_DOMAIN}`)) {
    return Response.redirect(env.PUBLIC_ORIGIN, 301);
  }
  if (env.SITES_DOMAIN && url.hostname.endsWith(`.${env.SITES_DOMAIN}`)) {
    const slug = url.hostname.slice(0, -(env.SITES_DOMAIN.length + 1));
    if (!/^[a-z0-9-]+$/.test(slug)) return new Response("Not found", { status: 404 });
    if (method === "GET" && path === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });
    }
    const tap = path.match(/^\/t\/([a-z]+)$/);
    if (method === "POST" && tap) return countTap(request, env, ctx, slug, tap[1]!);
    if (method !== "GET") return Response.redirect(`https://${url.hostname}/`, 302);
    const site = await loadSite(env, slug);
    if (!site) {
      // A renamed site: the old address keeps working, permanently.
      const target = await aliasTarget(env, slug);
      if (target) return Response.redirect(`https://${target}.${env.SITES_DOMAIN}${path}`, 301);
    }
    // Photos and the video come from the site's own host, so the page needs
    // nothing from another origin (CSP 'self'), and only this site's files.
    if (path.startsWith("/p/")) {
      const key = decodeURIComponent(path.slice(3));
      if (site?.status === "live" && (site.photos.includes(key) || site.video === key)) return photo(env, key, request);
      return new Response("Not found", { status: 404 });
    }
    if (path !== "/") return Response.redirect(`https://${url.hostname}/`, 302);
    return serveSite(env, slug, site, { request, ctx, ping: true });
  }

  if (method === "GET") {
    if (path === "/") {
      const cfg = billingConfig(env);
      return html(homePage(cfg.on, cfg.on && festiveOpen(cfg, new Date()) ? endOf(cfg.festiveUntil!) : null));
    }
    if (path === "/new") return builder(env, { kind: "new" });
    if (path === "/privacy") return html(privacyPage());
    if (path === "/terms") return html(termsPage());
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /edit/\nDisallow: /api/\n", { headers: { "content-type": "text/plain" } });
    if (path === "/metrics") return metrics(request, env);
    if (path === "/api/admin/sites") return adminList(request, env);
    if (path === "/api/address") return addressCheck(env, url);
    if (path === "/api/internal/resolve") return resolveInternal(request, env, url);
    let m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/offer-status$/);
    if (m) return offerStatusInternal(request, env, m[1]!);
    m = path.match(/^\/s\/([a-z0-9-]+)\/?$/);
    // Old path links (before the customer-site domain) move to the subdomain.
    if (m) {
      const current = (await aliasTarget(env, m[1]!)) ?? m[1]!;
      return env.SITES_DOMAIN ? Response.redirect(siteUrl(env, current), 301) : serveSite(env, current, undefined, { request, ctx, ping: false });
    }
    m = path.match(/^\/edit\/([a-z0-9-]+)$/);
    if (m) {
      const target = (await env.SITES.get(siteKey(m[1]!))) ? null : await aliasTarget(env, m[1]!);
      const k = url.searchParams.get("k") ?? "";
      if (target) return Response.redirect(`${env.PUBLIC_ORIGIN}/edit/${target}?k=${encodeURIComponent(k)}`, 302);
      return editPage(env, m[1]!, k, url.searchParams.get("paid") === "1");
    }
    if (path.startsWith("/p/")) return photo(env, decodeURIComponent(path.slice(3)), request);
    m = path.match(/^\/done\/([A-Za-z0-9_-]+)$/);
    if (m) return done(env, m[1]!);
  }

  if (method === "POST") {
    if (path === "/api/sites") return createSite(request, env);
    if (path === "/api/internal/sites") return createInternal(request, env);
    if (path === "/api/billing/checkout") return billingCheckout(request, env);
    if (path === "/api/billing/portal") return billingPortal(request, env);
    if (path === "/webhooks/stripe") return stripeWebhook(request, env);
    let m = path.match(/^\/api\/sites\/([a-z0-9-]+)$/);
    if (m) return updateSite(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/offer$/);
    if (m) return setOfferInternal(request, env, m[1]!);
    m = path.match(/^\/api\/sites\/([a-z0-9-]+)\/delete$/);
    if (m) return deleteSite(request, env, m[1]!);
    m = path.match(/^\/api\/admin\/sites\/([a-z0-9-]+)\/remove$/);
    if (m) return adminRemove(request, env, m[1]!);
  }

  return html(messagePage("Page not found", "There's nothing at this address."), 404);
}

// ---------------------------------------------------------------------------
// Responses

function nonce(): string {
  return randomKey(16);
}

function html(body: string, status = 200, scriptNonce?: string): Response {
  const csp = [
    "default-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "style-src 'unsafe-inline'",
    scriptNonce ? `script-src 'nonce-${scriptNonce}'` : "script-src 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "cache-control": "no-store",
    },
  });
}

function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

// ---------------------------------------------------------------------------
// Storage

const siteKey = (slug: string) => `site:${slug}`;

async function loadSite(env: Env, slug: string): Promise<Site | null> {
  return env.SITES.get<Site>(siteKey(slug), "json");
}

async function saveSite(env: Env, site: Site): Promise<void> {
  await env.SITES.put(siteKey(site.slug), JSON.stringify(site), {
    metadata: {
      status: site.status,
      source: site.source,
      createdAt: site.createdAt,
      ...(site.possibleDuplicateOf ? { possibleDuplicateOf: site.possibleDuplicateOf } : {}),
    },
  });
}

const aliasKey = (slug: string) => `alias:${slug}`;

/** The current address of a renamed site, or null. */
async function aliasTarget(env: Env, slug: string): Promise<string | null> {
  return env.SITES.get(aliasKey(slug));
}

/** Taken by a site, or held by a renamed site as its old address. */
async function addressTaken(env: Env, slug: string): Promise<boolean> {
  return Boolean((await env.SITES.get(siteKey(slug))) || (await env.SITES.get(aliasKey(slug))));
}

/** The first free default (name, name-type, name-town), else name-2, name-3… */
async function uniqueSlug(env: Env, businessName: string, category: string, city: string): Promise<string> {
  const suggestions = suggestAddresses(businessName, category, city);
  for (const s of suggestions) if (!(await addressTaken(env, s))) return s;
  const base = suggestions[0] ?? "my-business";
  for (let i = 2; i < 30; i += 1) {
    const candidate = `${base}-${i}`.slice(0, MAX_LEN);
    if (addressProblem(candidate) === null && !(await addressTaken(env, candidate))) return candidate;
  }
  return `${base.slice(0, 30)}-${randomKey(6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** Checks a requested address; null when it can be used. */
async function requestedAddressProblem(env: Env, slug: string): Promise<string | null> {
  return addressProblem(slug) ?? ((await addressTaken(env, slug)) ? "That address is taken. Try another." : null);
}

// GET /api/address?slug=&name=&category=&city=  (public, read-only; CORS open
// so AdVault's page can check as the owner types).
async function addressCheck(env: Env, url: URL): Promise<Response> {
  const q = (k: string) => (url.searchParams.get(k) ?? "").slice(0, 120);
  const typed = q("slug");
  const suggestions = [];
  for (const s of suggestAddresses(q("name"), q("category"), q("city"))) {
    if (!(await addressTaken(env, s))) suggestions.push(s);
    if (suggestions.length >= 3) break;
  }
  let address = typed ? normaliseAddress(typed) : (suggestions[0] ?? "");
  const problem = address ? await requestedAddressProblem(env, address) : "Type an address.";
  const res = json({ address, available: problem === null, problem, suggestions, domain: env.SITES_DOMAIN ?? null });
  res.headers.set("access-control-allow-origin", "*");
  return res;
}

// GET /api/internal/resolve?slug=  -> the site's current address (follows a
// rename). AdVault calls it so a campaign's link follows the site.
async function resolveInternal(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const slug = url.searchParams.get("slug") ?? "";
  const current = (await env.SITES.get(siteKey(slug))) ? slug : await aliasTarget(env, slug);
  const site = current ? await loadSite(env, current) : null;
  if (!site || site.status !== "live") return json({ ok: false, error: "not_found" }, 404);
  return json({ ok: true, slug: site.slug, siteUrl: siteUrl(env, site.slug) });
}

/** A live site by its current or an old address (renames are followed). */
async function liveSiteFollowingAliases(env: Env, slug: string): Promise<Site | null> {
  const current = (await env.SITES.get(siteKey(slug))) ? slug : await aliasTarget(env, slug);
  const site = current ? await loadSite(env, current) : null;
  return site && site.status === "live" ? site : null;
}

// GET /api/internal/sites/<slug>/offer-status -> what AdVault needs to quote
// its offer combo: the current offer, credits left, and whether billing is on.
async function offerStatusInternal(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const site = await liveSiteFollowingAliases(env, slug);
  if (!site) return json({ ok: false, error: "not_found" }, 404);
  const cfg = billingConfig(env);
  return json({
    ok: true,
    slug: site.slug,
    offer: site.offer,
    credits: billingOf(site).credits,
    billing: cfg.on ? "on" : "off",
    siteState: siteState(site, cfg, new Date()),
  });
}

type OfferResult = { ok: true; slug: string; offer: string; credits: number; creditShort?: true };
const offerRefKey = (ref: string) => `offerref:${ref}`;

// POST /api/internal/sites/<slug>/offer  { offer, payment: "advault"|"credit", ref }
// AdVault's $12 offer combo (or $10 + 1 SiteVault credit). Idempotent on ref:
// a repeat replays the first result and never spends a second credit.
async function setOfferInternal(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const parsed = parseInternalOffer(body);
  if (!parsed.ok) return json({ ok: false, error: "invalid", detail: parsed.error }, 400);
  const { offer, payment, ref } = parsed.value;

  const prior = offerRefDecision(await env.SITES.get<OfferResult>(offerRefKey(ref), "json"));
  if (prior.replay) return json(prior.result);

  const site = await liveSiteFollowingAliases(env, slug);
  if (!site) return json({ ok: false, error: "not_found" }, 404);
  const cfg = billingConfig(env);
  // Billing may have changed a moment ago (a webhook landed): decide on the
  // freshest copy so this save never undoes a payment or a credit pack.
  const fresh = (await loadSite(env, site.slug)) ?? site;
  const b = billingOf(fresh);
  const charge = internalOfferSpend(payment, fresh.offer, offer, b.credits, cfg.on);
  const billing = charge.spend === 1 ? { ...b, credits: b.credits - 1 } : fresh.billing;
  await saveSite(env, { ...fresh, offer, ...(billing ? { billing } : {}), updatedAt: new Date().toISOString() });
  if (charge.creditShort) console.warn("offer_credit_short", { slug: fresh.slug, ref });
  console.log("offer_set_internal", { slug: fresh.slug, payment, spend: charge.spend, ref });

  const result: OfferResult = {
    ok: true,
    slug: fresh.slug,
    offer,
    credits: billingOf({ billing }).credits,
    ...(charge.creditShort ? { creditShort: true as const } : {}),
  };
  await env.SITES.put(offerRefKey(ref), JSON.stringify(result), { expirationTtl: OFFER_REF_TTL_SECONDS });
  return json(result);
}

function renderCtx(env: Env, slug: string): RenderContext {
  return {
    siteUrl: siteUrl(env, slug),
    // Same host as the page once sites have their own subdomain.
    assetOrigin: env.SITES_DOMAIN ? `https://${slug}.${env.SITES_DOMAIN}` : env.PUBLIC_ORIGIN,
    homeUrl: env.PUBLIC_ORIGIN,
  };
}

function siteUrl(env: Env, slug: string): string {
  return env.SITES_DOMAIN ? `https://${slug}.${env.SITES_DOMAIN}/` : `${env.PUBLIC_ORIGIN}/s/${slug}`;
}

// ---------------------------------------------------------------------------
// Pages

async function serveSite(
  env: Env,
  slug: string,
  preloaded: Site | null | undefined,
  visit: { request: Request; ctx: ExecutionContext; ping: boolean },
): Promise<Response> {
  const site = preloaded !== undefined ? preloaded : await loadSite(env, slug);
  if (!site || site.status !== "live") {
    return html(messagePage("This website isn't available", "It may have been removed by its owner."), 404);
  }
  // BILLING off: always "live", exactly as before paid plans.
  const cfg = billingConfig(env);
  const now = new Date();
  const state = siteState(site, cfg, now);
  if (state === "unpublished" || state === "paused") {
    const res = html(renderHold(site, state));
    res.headers.set("x-robots-tag", "noindex");
    return res;
  }
  if (countsVisits(site, cfg, now)) countView(env, visit.ctx, visit.request, site);
  const res = html(renderSite(site, { ...renderCtx(env, slug), ping: visit.ping && Boolean(env.STATS) }));
  // Short edge cache: edits show within a minute, traffic spikes from an ad
  // don't hit KV for every visitor.
  res.headers.set("cache-control", "public, max-age=60");
  return res;
}

/** The "your site is live" page after a script-driven create (10-minute handoff). */
async function done(env: Env, handoff: string): Promise<Response> {
  const data = await env.SITES.get<{ siteUrl: string; editUrl: string; publish?: Parameters<typeof donePage>[0]["publish"] }>(
    `done:${handoff}`,
    "json",
  );
  if (!data) return html(messagePage("This page has expired", "Open your website or your edit link directly.", "Expired"), 404);
  const n = nonce();
  const res = html(donePage({ ...data, nonce: n }), 200, n);
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

function builder(_env: Env, mode: Parameters<typeof builderPage>[0], errors?: FieldErrors, values?: Record<string, string>, status = 200): Response {
  const n = nonce();
  return html(builderPage(mode, n, errors, values, _env.SITES_DOMAIN ?? null), status, n);
}

async function editPage(env: Env, slug: string, key: string, justPaid = false): Promise<Response> {
  const site = await authorize(env, slug, key);
  if (!site) return html(messagePage("Edit link not valid", "Check you copied the whole link. Lost it? Email 3pandas@3pandalabs.com.", "Can't open"), 403);
  return builder(env, await editMode(env, site, key, justPaid));
}

/** The edit form plus its "Plan & billing" (BILLING on) and "Visitors" (STATS bound) sections. */
async function editMode(env: Env, site: Site, key: string, justPaid = false): Promise<FormMode & { kind: "edit" }> {
  const cfg = billingConfig(env);
  const now = new Date();
  let billing: BillingView | undefined;
  if (cfg.on) {
    const b = billingOf(site);
    billing = {
      state: siteState(site, cfg, now),
      billing: b,
      source: site.source,
      prices: planPrices(site.source, festiveFor(b, cfg, now)),
      paidUntil: effectivePaidUntil(b, cfg),
      justPaid,
    };
  }
  let stats = null;
  if (env.STATS) {
    try {
      stats = await readStats(env.STATS, [site.slug, ...(site.aliases ?? [])], now);
    } catch (err) {
      console.warn("stats read failed", String(err));
    }
  }
  return {
    kind: "edit",
    site,
    key,
    photoUrl: (k) => `${env.PUBLIC_ORIGIN}/p/${k}`,
    billing,
    visitors: stats ? { stats, full: statsVisible(site, cfg, now) } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Stats

function countView(env: Env, ctx: ExecutionContext, request: Request, site: Site): void {
  if (!env.STATS || request.method !== "GET") return;
  const ua = request.headers.get("user-agent");
  if (isBot(ua) || isPrefetch(request.headers)) return;
  const url = new URL(request.url);
  const source = classifySource(url, request.headers.get("referer"), url.hostname);
  const hit = hitFor(site.slug, source, request.cf as { country?: unknown; city?: unknown } | undefined, ua, new Date());
  ctx.waitUntil(recordHit(env.STATS, hit, "view").catch((err) => console.warn("stats write failed", String(err))));
}

// POST /t/<kind> from an HTML ping attribute on a customer site. Always 204,
// even when nothing is counted, so a ping never shows an error anywhere.
async function countTap(request: Request, env: Env, ctx: ExecutionContext, slug: string, kind: string): Promise<Response> {
  const done = new Response(null, { status: 204 });
  if (!env.STATS || !TAP_KINDS.includes(kind as TapKind)) return done;
  const ua = request.headers.get("user-agent");
  if (isBot(ua)) return done;
  const site = await loadSite(env, slug);
  if (!site || site.status !== "live" || !countsVisits(site, billingConfig(env), new Date())) return done;
  const source = tapSource(request.headers.get("ping-from"), request.headers.get("referer"));
  const hit = hitFor(site.slug, source, request.cf as { country?: unknown; city?: unknown } | undefined, ua, new Date());
  ctx.waitUntil(recordHit(env.STATS, hit, kind as TapKind).catch((err) => console.warn("tap write failed", String(err))));
  return done;
}

// ---------------------------------------------------------------------------
// Billing (see billing.ts for the rules, stripe.ts for the API calls)

function priceIds(env: Env): PriceIds {
  return {
    BASIC: env.STRIPE_PRICE_BASIC || undefined,
    BASIC_FESTIVE: env.STRIPE_PRICE_BASIC_FESTIVE || undefined,
    PRO: env.STRIPE_PRICE_PRO || undefined,
    PRO_ADVAULT: env.STRIPE_PRICE_PRO_ADVAULT || undefined,
    CREDITS: env.STRIPE_PRICE_CREDITS || undefined,
  };
}

const editUrlFor = (env: Env, slug: string, key: string) => `${env.PUBLIC_ORIGIN}/edit/${slug}?k=${encodeURIComponent(key)}`;

async function billingCheckout(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const slug = form?.fields.slug ?? "";
  const key = form?.fields.key ?? "";
  const site = /^[a-z0-9-]+$/.test(slug) ? await authorize(env, slug, key) : null;
  if (!site) return html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't pay"), 403);
  if (!billingConfig(env).on) return html(messagePage("Nothing to pay", "SiteVault is free during early access.", "Free"), 404);
  const kind = form?.fields.kind ?? "";
  const problem = checkoutProblem(kind, site.source, billingOf(site));
  if (problem) return html(messagePage("Can't start the payment", problem, "Billing"), 400);
  const unavailable = () => html(messagePage("Payments are not available right now", "Please try again later. Your website is not affected.", "Unavailable"), 503);
  if (!env.STRIPE_SECRET_KEY) return unavailable();
  const params = checkoutParams({
    kind: kind as CheckoutKind,
    slug: site.slug,
    source: site.source,
    billing: billingOf(site),
    prices: priceIds(env),
    returnUrl: editUrlFor(env, site.slug, key),
    festive: festiveFor(billingOf(site), billingConfig(env), new Date()),
  });
  if (!params.ok) {
    console.error("stripe price missing", { price: params.missing });
    return unavailable();
  }
  try {
    return Response.redirect(await createCheckoutSession(env.STRIPE_SECRET_KEY, params.params), 303);
  } catch (err) {
    console.error("checkout failed", String(err));
    return unavailable();
  }
}

async function billingPortal(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const slug = form?.fields.slug ?? "";
  const key = form?.fields.key ?? "";
  const site = /^[a-z0-9-]+$/.test(slug) ? await authorize(env, slug, key) : null;
  if (!site) return html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't open"), 403);
  const customer = site.billing?.customerId;
  if (!customer) return html(messagePage("No billing yet", "There's no payment on this website yet.", "Billing"), 404);
  const unavailable = () => html(messagePage("Billing is not available right now", "Please try again later. Your website is not affected.", "Unavailable"), 503);
  if (!env.STRIPE_SECRET_KEY) return unavailable();
  try {
    return Response.redirect(await createPortalSession(env.STRIPE_SECRET_KEY, customer, editUrlFor(env, site.slug, key)), 303);
  } catch (err) {
    console.error("portal failed", String(err));
    return unavailable();
  }
}

// Stripe webhook. The account is shared by several 3PandaLabs apps: events
// for objects not tagged metadata.app = "sitevault" are acknowledged (200)
// and ignored. Every processed event id is kept 30 days (evt:<id>) so a
// retried delivery can't add credits twice.
async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "webhook_disabled" }, 503);
  const raw = await request.text();
  const ok = await verifyStripeSignature(request.headers.get("stripe-signature"), raw, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
  if (!ok) return json({ error: "bad_signature" }, 400);
  let evt: { id?: unknown; type?: unknown };
  try {
    evt = JSON.parse(raw);
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const ev = eventFromStripe(evt);
  if (!ev) return json({ ok: true, ignored: true });
  const evtId = typeof evt.id === "string" ? evt.id : "";
  if (evtId && (await env.SITES.get(`evt:${evtId}`))) return json({ ok: true, duplicate: true });
  // Metadata holds the slug at payment time; follow a later rename.
  const current = (await env.SITES.get(siteKey(ev.slug))) ? ev.slug : await aliasTarget(env, ev.slug);
  const site = current ? await loadSite(env, current) : null;
  if (!site) {
    console.warn("stripe event for unknown site", { type: ev.type, slug: ev.slug });
    return json({ ok: true, unknownSite: true });
  }
  const { billing, cancel } = applyEvent(billingOf(site), ev, new Date());
  await saveSite(env, { ...site, billing });
  if (evtId) await env.SITES.put(`evt:${evtId}`, "1", { expirationTtl: 30 * 24 * 60 * 60 });
  console.log("billing_event", { type: ev.type, slug: site.slug, plan: billing.plan, paidUntil: billing.paidUntil });
  if (cancel && env.STRIPE_SECRET_KEY) {
    try {
      await cancelSubscription(env.STRIPE_SECRET_KEY, cancel);
    } catch (err) {
      console.error("cancel replaced subscription failed", { slug: site.slug, subscription: cancel, err: String(err) });
    }
  }
  return json({ ok: true });
}

async function authorize(env: Env, slug: string, key: string): Promise<Site | null> {
  if (!key) return null;
  const site = await loadSite(env, slug);
  if (!site || site.status !== "live") return null;
  return safeEqual(await sha256Hex(key), site.editKeyHash) ? site : null;
}

// Photos and the ad video. Byte ranges are supported because iPhone Safari
// will not play a <video> whose server ignores Range.
async function photo(env: Env, key: string, request: Request): Promise<Response> {
  if (!/^sites\/[a-z0-9-]+\/[A-Za-z0-9_-]+\.(jpg|png|webp|mp4)$/.test(key)) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    // Keys are random and never reused, so they can be cached forever.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  });
  const range = parseRange(request.headers.get("range"));
  if (range) {
    const obj = await env.PHOTOS.get(key, { range });
    if (!obj || !("body" in obj)) return new Response("Not found", { status: 404 });
    const start = "offset" in range ? range.offset : Math.max(0, obj.size - range.suffix);
    const end = "length" in range && range.length !== undefined ? Math.min(obj.size, start + range.length) - 1 : obj.size - 1;
    headers.set("content-type", obj.httpMetadata?.contentType ?? "application/octet-stream");
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  headers.set("content-type", obj.httpMetadata?.contentType ?? "image/jpeg");
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

/** "bytes=0-" / "bytes=100-199" / "bytes=-500" -> an R2 range, else null. */
function parseRange(h: string | null): { offset: number; length?: number } | { suffix: number } | null {
  const m = h?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] ? { offset, length: Number(m[2]) - offset + 1 } : { offset };
}

// ---------------------------------------------------------------------------
// Create / update / delete

type Parsed = { fields: Record<string, string>; files: File[]; keep: string[]; video: File | null };

async function readForm(request: Request): Promise<Parsed | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data") && !type.includes("application/x-www-form-urlencoded")) return null;
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const files: File[] = [];
  const keep: string[] = [];
  let video: File | null = null;
  for (const [k, v] of form as unknown as Iterable<[string, string | File]>) {
    if (typeof v === "string") {
      if (k === "keep") keep.push(v);
      else fields[k] = v;
    } else if (k === "photos" && v.size > 0) {
      files.push(v);
    } else if (k === "video" && v.size > 0) {
      video = v;
    }
  }
  return { fields, files, keep, video };
}

function checkPhotos(files: File[], existing: number, maxBytes = MAX_PHOTO_BYTES): string | null {
  if (existing + files.length > MAX_PHOTOS) return `Up to ${MAX_PHOTOS} photos in total.`;
  for (const f of files) {
    if (!PHOTO_TYPES.includes(f.type)) return "Photos must be JPG, PNG or WebP.";
    if (f.size > maxBytes) return `Each photo must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }
  return null;
}

/** Store a validated site and mint its edit key. Shared by both create paths. */
// ---------------------------------------------------------------------------
// One website per business. SiteVault has no accounts, so the business phone
// is the identity: one LIVE site per phone number (phone:<digits> -> slug).
// The same name in the same town is only a soft signal (a different phone,
// a second location): it is flagged for admin review, never blocked.
// AdVault adds its own stronger rule on top: one site per AdVault account.

const phoneKey = (phone: string) => `phone:${phoneIdentity(phone)}`;
const nameTownKey = (name: string, city: string) => `nt:${slugify(name)}|${slugify(city.split(",")[0] ?? "")}`;

/** The live site already using this phone (other than `self`), or null. */
async function phoneOwner(env: Env, phone: string, self?: string): Promise<string | null> {
  const slug = await env.SITES.get(phoneKey(phone));
  if (!slug || slug === self) return null;
  const site = await loadSite(env, slug);
  if (site?.status !== "live") return null;
  // An unpaid draft (BILLING on, never published) holds the number for 2 days
  // only, so an abandoned checkout can't lock the business out for good.
  if (site.billing?.status === "pending" && Date.now() - Date.parse(site.createdAt) > PENDING_PHONE_HOLD_MS) return null;
  return slug;
}

const PENDING_PHONE_HOLD_MS = 2 * 24 * 60 * 60 * 1000;

const PHONE_TAKEN =
  "A website already exists for this phone number. Use its edit link to change it, or email 3pandas@3pandalabs.com if you didn't make it.";

async function indexSite(env: Env, site: Site): Promise<void> {
  await env.SITES.put(phoneKey(site.phone), site.slug);
  await env.SITES.put(nameTownKey(site.businessName, site.city), site.slug);
}

async function unindexSite(env: Env, site: Pick<Site, "slug" | "phone" | "businessName" | "city">): Promise<void> {
  for (const k of [phoneKey(site.phone), nameTownKey(site.businessName, site.city)]) {
    if ((await env.SITES.get(k)) === site.slug) await env.SITES.delete(k);
  }
}

/** Another live site with the same name in the same town, for admin review. */
async function nameTownDuplicate(env: Env, name: string, city: string, self?: string): Promise<string | null> {
  const slug = await env.SITES.get(nameTownKey(name, city));
  if (!slug || slug === self) return null;
  const site = await loadSite(env, slug);
  return site?.status === "live" ? slug : null;
}

async function insertSite(
  env: Env,
  content: SiteContent,
  files: File[],
  source: Site["source"],
  videoFile: File | null = null,
  requested: string | null = null,
) {
  const slug = requested ?? (await uniqueSlug(env, content.businessName, content.category, content.city));
  const key = randomKey();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  // BILLING off: no billing record, so the site counts as early access later.
  const billing = initialBilling(source, billingConfig(env), nowDate);
  const site: Site = {
    ...(billing ? { billing } : {}),
    ...content,
    slug,
    photos: await storePhotos(env, slug, files),
    video: await storeVideo(env, slug, videoFile),
    status: "live",
    source,
    editKeyHash: await sha256Hex(key),
    createdAt: now,
    updatedAt: now,
  };
  const dup = await nameTownDuplicate(env, content.businessName, content.city);
  if (dup) site.possibleDuplicateOf = dup;
  await saveSite(env, site);
  await indexSite(env, site);
  console.log("site_created", { slug, source, photos: site.photos.length, category: site.category, possibleDuplicateOf: dup });
  return { slug, siteUrl: siteUrl(env, slug), editUrl: editUrlFor(env, slug, key), key, pending: billing?.status === "pending" };
}

// One-click from AdVault. Server to server, bearer INTERNAL_TOKEN. The
// advertiser attested ownership inside AdVault, so no attest field; no per-IP
// limit (every call comes from the AdVault box). Photos are AdVault's own
// polished ad photos, which can be larger than a phone-shrunk upload.
async function createInternal(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const form = await readForm(request);
  if (!form) return json({ ok: false, error: "bad_request" }, 400);
  const parsed = parseContent(form.fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  const photoErr = checkPhotos(form.files, 0, 8 * 1024 * 1024);
  if (photoErr) errors.photos = photoErr;
  // Only the internal path takes a video (AdVault's finished ad); the public
  // form doesn't, so a stranger can't host arbitrary video on our domain.
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) {
    errors.video = "Video must be an MP4 under 40 MB.";
  }
  const requested = form.fields.slug ? normaliseAddress(form.fields.slug) : null;
  if (requested) {
    const problem = await requestedAddressProblem(env, requested);
    if (problem) errors.slug = problem;
  }
  if (parsed.ok && (await phoneOwner(env, parsed.value.phone))) errors.phone = PHONE_TAKEN;
  if (!parsed.ok || Object.keys(errors).length > 0) return json({ ok: false, error: "invalid", errors }, 400);
  const made = await insertSite(env, parsed.value, form.files, "advault", form.video, requested);
  return json({ ok: true, slug: made.slug, siteUrl: made.siteUrl, editUrl: made.editUrl }, 201);
}

// Web size: at most 1600 px on the long side, JPEG q82 (~150-300 KB). A
// phone photo or AdVault's polished ad photo is 1 MB+, and a page of them is
// slow on a phone. If the Images binding is missing or fails, the original is
// stored rather than losing the photo.
async function webSize(env: Env, f: File): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (env.IMAGES) {
    try {
      const out = await env.IMAGES.input(f.stream())
        .transform({ width: 1600, height: 1600, fit: "scale-down" })
        .output({ format: "image/jpeg", quality: 82 });
      const bytes = await out.response().arrayBuffer();
      if (bytes.byteLength > 0 && bytes.byteLength < f.size) return { bytes, type: "image/jpeg" };
    } catch (err) {
      console.warn("image resize failed, storing original", String(err));
    }
  }
  return { bytes: await f.arrayBuffer(), type: f.type };
}

async function storePhotos(env: Env, slug: string, files: File[]): Promise<string[]> {
  const keys: string[] = [];
  for (const f of files) {
    const { bytes, type } = await webSize(env, f);
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const key = `sites/${slug}/${randomKey(9)}.${ext}`;
    await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
    keys.push(key);
  }
  return keys;
}

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

async function storeVideo(env: Env, slug: string, file: File | null): Promise<string | null> {
  if (!file) return null;
  const key = `sites/${slug}/${randomKey(9)}.mp4`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "video/mp4" } });
  return key;
}

async function deletePhotos(env: Env, keys: string[]): Promise<void> {
  if (keys.length) await env.PHOTOS.delete(keys);
}

/** Error reply: JSON for the script, a re-rendered form otherwise. */
function rejected(request: Request, env: Env, mode: Parameters<typeof builderPage>[0], errors: FieldErrors, fields: Record<string, string>, status = 400): Response {
  return wantsJson(request) ? json({ ok: false, errors }, status) : builder(env, mode, errors, fields, status);
}

async function rateLimited(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${await sha256Hex(`${ip}:${day}`)}`;
  const count = Number((await env.SITES.get(key)) ?? "0");
  const limit = Number(env.DAILY_CREATE_LIMIT ?? "5");
  if (count >= limit) return true;
  await env.SITES.put(key, String(count + 1), { expirationTtl: 60 * 60 * 26 });
  return false;
}

async function createSite(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const mode = { kind: "new" } as const;
  if (!form) return rejected(request, env, mode, { form: "Please use the form." }, {});
  const { fields, files } = form;

  const parsed = parseContent(fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  if (fields.attest !== "yes") errors.attest = "Please confirm this.";
  const photoErr = checkPhotos(files, 0);
  if (photoErr) errors.photos = photoErr;
  const requested = fields.slug ? normaliseAddress(fields.slug) : null;
  if (requested) {
    const problem = await requestedAddressProblem(env, requested);
    if (problem) errors.slug = problem;
  }
  if (parsed.ok && (await phoneOwner(env, parsed.value.phone))) errors.phone = PHONE_TAKEN;
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, fields);

  if (await rateLimited(request, env)) {
    return rejected(request, env, mode, { form: "Too many websites created from this connection today. Try again tomorrow." }, fields, 429);
  }

  const { slug, editUrl, key, pending } = await insertSite(env, parsed.value, files, "web", null, requested);
  // BILLING on: the site waits for payment; the done page offers Publish.
  const publish = pending ? { slug, key, prices: planPrices("web", festiveOpen(billingConfig(env), new Date())) } : undefined;
  const n = nonce();
  const page = donePage({ siteUrl: siteUrl(env, slug), editUrl, nonce: n, publish });
  // The done page carries the only copy of the edit key: render it straight
  // into this response rather than redirecting with the key in a URL that
  // ends up in history. The script path gets the same page via a one-time
  // KV handoff that expires in 10 minutes.
  if (wantsJson(request)) {
    const handoff = randomKey(18);
    await env.SITES.put(`done:${handoff}`, JSON.stringify({ siteUrl: siteUrl(env, slug), editUrl, ...(publish ? { publish } : {}) }), {
      expirationTtl: 600,
    });
    return json({ ok: true, next: `/done/${handoff}` });
  }
  return html(page, 201, n);
}

async function updateSite(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  if (!form) return json({ ok: false, errors: { form: "Please use the form." } }, 400);
  const site = await authorize(env, slug, form.fields.key ?? "");
  if (!site) {
    return wantsJson(request)
      ? json({ ok: false, errors: { form: "Your edit link isn't valid any more. Reload it and try again." } }, 403)
      : html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't save"), 403);
  }
  const mode = await editMode(env, site, form.fields.key!);

  const parsed = parseContent(form.fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  // Offer credits (BILLING on): a new, different, non-empty offer costs 1.
  const cfg = billingConfig(env);
  const spend = parsed.ok ? offerSpend(site.offer, parsed.value.offer, billingOf(site).credits, cfg.on) : ({ ok: true, spend: 0 } as const);
  if (!spend.ok) {
    errors.offer = "Changing your special uses 1 credit and you have none left. Buy more credits in Plan & billing above, or keep the current special.";
  }
  const kept = site.photos.filter((k) => form.keep.includes(k));
  const photoErr = checkPhotos(form.files, kept.length);
  if (photoErr) errors.photos = photoErr;
  // A new address: allowed a few times; the old one becomes a permanent redirect.
  const wanted = form.fields.slug ? normaliseAddress(form.fields.slug) : site.slug;
  const renaming = wanted !== site.slug;
  if (renaming) {
    if ((site.renames ?? 0) >= MAX_RENAMES) errors.slug = "This website's address has been changed the maximum number of times.";
    else if ((site.aliases ?? []).includes(wanted)) errors.slug = "";
    else {
      const problem = await requestedAddressProblem(env, wanted);
      if (problem) errors.slug = problem;
    }
    // Going back to one of its own old addresses is allowed.
    if (errors.slug === "") delete errors.slug;
  }
  if (parsed.ok && (await phoneOwner(env, parsed.value.phone, site.slug))) errors.phone = PHONE_TAKEN;
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, form.fields);

  const removed = site.photos.filter((k) => !kept.includes(k));
  const dropVideo = Boolean(site.video) && form.fields.keepVideo !== "yes";
  if (dropVideo && site.video) removed.push(site.video);
  const added = await storePhotos(env, slug, form.files);
  // Billing may have changed while the owner was editing (a webhook landed):
  // start from the freshest copy so a save never undoes a payment.
  const fresh = (await loadSite(env, slug))?.billing ?? site.billing;
  let billing = fresh;
  if (spend.ok && spend.spend === 1) {
    const b = billingOf({ billing: fresh });
    if (b.credits < 1) return rejected(request, env, mode, { offer: "You have no offer credits left. Buy more in Plan & billing above." }, form.fields, 402);
    billing = { ...b, credits: b.credits - 1 };
  }
  const next: Site = {
    ...site,
    ...parsed.value,
    ...(billing ? { billing } : {}),
    photos: [...kept, ...added],
    video: dropVideo ? null : (site.video ?? null),
    updatedAt: new Date().toISOString(),
  };
  if (renaming) {
    const aliases = [...new Set([...(site.aliases ?? []), site.slug])].filter((a) => a !== wanted);
    next.slug = wanted;
    next.aliases = aliases;
    next.renames = (site.renames ?? 0) + 1;
    await saveSite(env, next);
    // Every old address points at the new one (no redirect chains).
    await env.SITES.delete(aliasKey(wanted));
    for (const a of aliases) await env.SITES.put(aliasKey(a), wanted);
    await env.SITES.delete(siteKey(site.slug));
    console.log("site_renamed", { from: site.slug, to: wanted });
  } else {
    await saveSite(env, next);
  }
  await unindexSite(env, site);
  await indexSite(env, next);
  await deletePhotos(env, removed);

  const target = siteUrl(env, next.slug);
  return wantsJson(request) ? json({ ok: true, next: target }) : Response.redirect(target, 303);
}

async function deleteSite(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  const site = form ? await authorize(env, slug, form.fields.key ?? "") : null;
  if (!site) return html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't remove"), 403);
  await removeSite(env, site);
  return html(messagePage("Your website has been removed", "It's offline and its photos are deleted.", "Removed"));
}

async function removeSite(env: Env, site: Site): Promise<void> {
  // Keep the record (status removed) so the slug isn't handed to someone else
  // and an abuse report can still be traced; the content is the photos.
  await deletePhotos(env, site.video ? [...site.photos, site.video] : site.photos);
  await saveSite(env, { ...site, photos: [], video: null, status: "removed", updatedAt: new Date().toISOString() });
  await unindexSite(env, site);
}

// ---------------------------------------------------------------------------
// Ops

function bearer(request: Request, expected: string | undefined): "ok" | "off" | "no" {
  if (!expected) return "off";
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(presented, expected) ? "ok" : "no";
}

async function listSites(env: Env): Promise<{ name: string; metadata?: unknown }[]> {
  const out: { name: string; metadata?: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.SITES.list({ prefix: "site:", cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

async function metrics(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.METRICS_TOKEN);
  if (auth === "off") return json({ error: "metrics_disabled" }, 503);
  if (auth === "no") return json({ error: "unauthorized" }, 401);
  const keys = await listSites(env);
  const meta = keys.map((k) => (k.metadata ?? {}) as { status?: string; source?: string });
  // Shared envelope across 3PandaLabs apps (see mealmargin's /metrics). No
  // database and no long-lived process, so those parts are null.
  return json({
    app: "sitevault",
    collectedAt: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
    counts: {
      sites: keys.length,
      sitesLive: meta.filter((m) => m.status === "live").length,
      sitesFromAdvault: meta.filter((m) => m.source === "advault").length,
    },
    traffic: null,
    process: null,
    database: null,
  });
}

async function adminList(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.ADMIN_TOKEN);
  if (auth !== "ok") return json({ error: auth === "off" ? "admin_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const keys = await listSites(env);
  return json({ sites: keys.map((k) => ({ slug: k.name.slice(5), ...(k.metadata as object), url: siteUrl(env, k.name.slice(5)) })) });
}

async function adminRemove(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.ADMIN_TOKEN);
  if (auth !== "ok") return json({ error: auth === "off" ? "admin_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const site = await loadSite(env, slug);
  if (!site) return json({ error: "not_found" }, 404);
  await removeSite(env, site);
  console.log("site_removed_by_admin", { slug });
  return json({ ok: true });
}
