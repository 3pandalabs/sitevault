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
//   GET  /edit/<slug>?embed=1      the same editor inside AdVault's "Your website" (session only; no
//                                  SiteVault chrome or billing; framable by AdVault only)
//   GET  /embed/session?token=     AdVault's signed, single-use, 60 s handoff: signs the owner in, -> embed editor
//   POST /preview[?site=<slug>]    the builder's "Preview my website": renders the posted form, saves NOTHING
//   GET  /go/advault?to=<path>     one-tap sign-in to AdVault: a 60 s single-use token -> AdVault /auth/handoff
//   GET  /auth/handoff?t=&to=      one-tap sign-in FROM AdVault: checks AdVault's token, sets the session, -> to
//   GET  /embed/new?token=         AdVault create mode: create handoff (own token type), -> /embed/new?draft=<id>
//   GET  /embed/new?draft=<id>     the FULL builder in embed chrome, pre-filled from AdVault's draft (session)
//   GET  /embed/draft/<id>/<file>  a draft photo (session, that draft's account only)
//   POST /api/embed/sites          create from the embedded builder (session + draft) -> /embed/created
//   GET  /embed/created?draft=<id> "Created"; posts sitevault:created to AdVault's origin only
//   POST /api/internal/drafts      AdVault stores the create pre-fill (INTERNAL_TOKEN) -> draftId
//   GET  /api/internal/drafts/<id>?advaultUserId=   the draft's create result (INTERNAL_TOKEN)
//   POST /api/sites/<slug>         update (key in the form)
//   GET  /p/<key>                  photo (or before & after photo) from R2
//   GET  /privacy, /terms
//   GET  /metrics                  ops envelope for admin.3pandalabs.com (METRICS_TOKEN)
//   GET  /api/admin/sites          list (ADMIN_TOKEN)
//   POST /api/admin/sites/<slug>/remove   takedown (ADMIN_TOKEN)
//   POST /api/internal/sites       one-click create from AdVault (INTERNAL_TOKEN)
//   GET  /api/internal/sites/<slug>/offer-status   offer, credits, billing (INTERNAL_TOKEN)
//   POST /api/internal/sites/<slug>/offer          set the offer from AdVault's combo (INTERNAL_TOKEN)
//   POST /api/internal/sites/<slug>/plan-cover     AdVault plan running: Pro covered until its period ends (INTERNAL_TOKEN)
//   POST /api/internal/sites/<slug>/paid           AdVault took the $10: publish with a year of Pro (INTERNAL_TOKEN)
//   GET  /api/internal/account-site?advaultUserId=&email=   the site that shared account owns (INTERNAL_TOKEN)
//   DELETE /api/internal/sites/<slug>?advaultUserId=&email=  AdVault admin "delete and make a new one": gone for good, address freed (INTERNAL_TOKEN)
//   HEAD on any GET route answers like the GET with no body and no side
//        effects (no visit counted, a /done handoff isn't used up)
//   POST /api/billing/checkout     Stripe Checkout (edit key in the form; BILLING on)
//   POST /api/billing/portal       Stripe billing portal (edit key in the form)
//   POST /webhooks/stripe          Stripe events (signature-checked; metadata.app = sitevault only)
//   POST <slug>.<SITES_DOMAIN>/t/<call|directions|offer>   tap counter (HTML ping), 204
//
// D1 STATS (optional): aggregate visit counters, see stats.ts. Writes go
// through ctx.waitUntil so a stats failure never slows or breaks a page.

import { photoUrl, renderHold, renderPolicyPage, renderSite, reviewResultPage, type RenderContext } from "./render.js";
import { ASSET_LINKS, PWA_ICONS, PWA_MANIFEST, SERVICE_WORKER, pngBytes } from "./pwa.js";
import { OG_PNG } from "./og-image.js";
import { wordmarkFontBytes } from "./wordmarkFont.js";
import { asBrandColor } from "./templates.js";
import { STARTERS, helpTopics, matchTopics } from "./help.js";
import { helperScript } from "./helper-client.js";
import { PANDA_WEBP } from "./panda-image.js";
import { HELPER_MARK, previewErrorsPage, accountPage, adminPage, authPage, builderPage, contactPage, donePage, embedCreatedPage, faqPage, forgotPasswordPage, homePage, messagePage, privacyPage, resetPasswordPage, shownEmail, termsPage, type AccountSite, type AdminSite, type BillingView, type FormMode, type VisitorsView } from "./pages.js";
import {
  accountByAdvaultId,
  accountByEmail,
  accountForAdvault,
  advaultLinkEmail,
  isIdOnlyAccount,
  changePassword,
  confirmPasswordReset,
  findAccountForAdvault,
  loadAccount,
  requestPasswordReset,
  saveAccount,
  verifyAdvaultLogin,
  markSitevaultUsed,
  moveToSharedAccount,
  signUpShared,
  addSiteToAccount,
  clearCookie,
  currentAccount,
  emailProblem,
  endSession,
  normaliseEmail,
  passwordProblem,
  sameOrigin,
  sendContact,
  sessionCookie,
  sessionToken,
  startSession,
  verifyPassword,
  type Account,
} from "./accounts.js";
import {
  applyAdvaultPaid,
  applyPlanCover,
  planCoverUntil,
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
  compBilling,
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
import { APP_COOKIE_SET, APP_PAYMENTS_MESSAGE, appModePage, appSignal, isAppRequest } from "./app.js";
import { cancelSubscription, createCheckoutSession, createPortalSession, retrieveCheckoutSession, verifyStripeSignature } from "./stripe.js";
import { TAP_KINDS, classifySource, hitFor, isBot, isPrefetch, readStats, recordHit, tapSource, type TapKind } from "./stats.js";
import {
  BEFORE_AFTER_FIELDS,
  INTERNAL_BEFORE_AFTER_TYPES,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  LISTING_PHOTO_FIELDS,
  LISTING_SLOTS,
  beforeAfterAllowed,
  checkMenu,
  checkScheduleFile,
  isMenuPdf,
  listingsAllowed,
  menuAllowed,
  scheduleAllowed,
  pickBeforeAfter,
  pickListings,
  siteFileKeys,
  type BeforeAfter,
  type BeforeAfterField,
  type Listing,
  parseContent,
  parseInternalOffer,
  parseReviewSubmission,
  MAX_APPROVED_REVIEWS,
  MAX_PENDING_REVIEWS,
  REVIEWS_PER_IP_PER_DAY,
  type FieldErrors,
  type PolicyKind,
  type Review,
  type Site,
  type SiteContent,
} from "./site.js";
import { policyPathKind } from "./policies.js";
import { DRAFT_ID, HANDOFF_JTI_TTL_SECONDS, allowEmbedFraming, verifyCreateHandoff, verifyHandoff } from "./embed.js";
import { ADVAULT_WEB_ORIGIN, SIGNIN_NONCE_TTL_SECONDS, mintSigninToken, safeLocalPath, verifySigninToken } from "./signin.js";
import { DRAFT_TTL_MS, draftExpired, draftFileKeys, draftPrefill, loadDraft, saveDraft, type Draft, type DraftFile } from "./drafts.js";
import { esc, randomKey, safeEqual, sha256Hex, slugify } from "./util.js";
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
  /** Comma-separated owner emails that publish websites free (3PandaLabs admins). */
  ADMIN_EMAILS?: string;
  /** Shared with advault-api (SITEVAULT_INTERNAL_TOKEN) for one-click sites. */
  INTERNAL_TOKEN?: string;
  /** AdVault API (DNS-only internal host: Workers can't fetch the proxied one). AdVault logins are checked there. */
  ADVAULT_API_URL?: string;
  /** Sites one network address may create per day. */
  DAILY_CREATE_LIMIT?: string;
  /** Visit stats (D1 sitevault-stats). Optional: skipped silently when absent. */
  STATS?: D1Database;
  /** Paid plans switch: "on" or anything else (off). */
  BILLING?: string;
  /** ISO date: sites made before billing started are paid until then. */
  EARLY_ACCESS_UNTIL?: string;
  /** ISO date: plans paid on or before this day keep festive prices for life (Basic $29, Pro $59). */
  FESTIVE_UNTIL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_BASIC?: string;
  STRIPE_PRICE_BASIC_FESTIVE?: string;
  STRIPE_PRICE_PRO_FESTIVE?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_PRO_ADVAULT?: string;
  STRIPE_PRICE_CREDITS?: string;
}

/** SiteVault's own public pages (the ones with a `path` in pages.ts). Never owner pages or customer sites. */
const SITEMAP_PATHS = ["/", "/new", "/privacy", "/terms", "/faq", "/contact"];

/** Tab icon: an "S" in SiteVault sky on the dark rounded square AdVault's "A" uses. */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#09090b"/><path d="M21.5 10.5C20 8.6 17.9 8 16 8c-3 0-5.5 1.7-5.5 4.2 0 5.6 11 3.3 11 9 0 2.4-2.4 4.3-5.6 4.3-2.3 0-4.4-.8-5.9-2.6" stroke="#38bdf8" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return httpsRedirect(request, env) ?? withHsts(request, env, await withAppMode(request, env, await handle(request, env, ctx)));
  },
} satisfies ExportedHandler<Env>;

/** Embed mode (AdVault's frame) is left exactly as it was: no app-mode rewriting there. */
function isEmbedRequest(url: URL): boolean {
  return url.pathname.startsWith("/embed/") || url.pathname === "/api/embed/sites" || url.searchParams.get("embed") === "1";
}

/**
 * Android app (TWA): payments on the website only (TODO(android-payments):
 * temporary, see app.ts). On the MAIN host, for a request from the app: set
 * the sv_app session cookie when the request itself says so, and send HTML
 * with every payment option replaced by APP_PAYMENTS_MESSAGE.
 */
async function withAppMode(request: Request, env: Env, res: Response): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== new URL(env.PUBLIC_ORIGIN).hostname || isEmbedRequest(url) || !isAppRequest(request)) return res;
  const isHtml = (res.headers.get("content-type") ?? "").startsWith("text/html");
  const signal = appSignal(request);
  if (!isHtml && !signal) return res;
  const headers = new Headers(res.headers);
  if (signal) headers.append("set-cookie", APP_COOKIE_SET);
  let body: BodyInit | null = res.body;
  if (isHtml && res.body && request.method !== "HEAD") {
    const out = appModePage(await res.text(), headers.get("content-security-policy"), nonce());
    body = out.page;
    if (out.csp) headers.set("content-security-policy", out.csp);
    headers.delete("content-length");
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/** Checkout/portal asked for from the app: refused (the buttons aren't shown there anyway). */
function appPaymentsBlocked(): Response {
  const page = messagePage("Pay on our website", APP_PAYMENTS_MESSAGE, "In the app").replace('<section class="hero"', '<section class="hero" data-app-blocked');
  return html(page, 403);
}

/**
 * The MAIN host only, and only when PUBLIC_ORIGIN is https (so a local run
 * with an http origin is untouched). Customer sites keep their behaviour.
 */
function isMainHost(url: URL, env: Env): boolean {
  const main = new URL(env.PUBLIC_ORIGIN);
  return main.protocol === "https:" && url.hostname === main.hostname;
}

/**
 * http -> https on the main host. No loop: the scheme is the visitor's own
 * (the Worker is the origin, nothing sits behind it) and the target is https.
 * GET/HEAD 301; other methods 308, which keeps method and body. Webhooks are
 * left alone: a sender may not follow redirects.
 */
function httpsRedirect(request: Request, env: Env): Response | null {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || !isMainHost(url, env) || url.pathname.startsWith("/webhooks/")) return null;
  url.protocol = "https:";
  return Response.redirect(url.toString(), request.method === "GET" || request.method === "HEAD" ? 301 : 308);
}

/** One day, this host only: no includeSubDomains (other apps' hosts), no preload. */
function withHsts(request: Request, env: Env, res: Response): Response {
  const url = new URL(request.url);
  if (url.protocol !== "https:" || !isMainHost(url, env)) return res;
  // Response.redirect() headers are immutable, so copy.
  const out = new Response(res.body, res);
  out.headers.set("strict-transport-security", "max-age=86400");
  return out;
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    // HEAD = GET without a body (monitors, link checkers and ad crawlers send
    // it). Routed as a GET with `head` set, so nothing is counted or used
    // up, then the body is dropped; status and headers are the GET's.
    if (request.method === "HEAD") {
      const res = await route(new Request(request, { method: "GET" }), env, ctx, true);
      return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    return await route(request, env, ctx);
  } catch (err) {
    console.error("unhandled", err instanceof Error ? err.stack : err);
    const res = html(messagePage("Something went wrong", "Please try again in a minute.", "Error"), 500);
    // Inside AdVault's frame, show the error instead of the browser's
    // "refused to connect" (only the embed editor and its handoff).
    const u = new URL(request.url);
    const embedded =
      u.pathname.startsWith("/embed/") ||
      u.pathname === "/api/embed/sites" ||
      (u.pathname.startsWith("/edit/") && u.searchParams.get("embed") === "1");
    return embedded ? allowEmbedFraming(res) : res;
  }
}

async function route(request: Request, env: Env, ctx: ExecutionContext, head = false): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // The wordmark font, self-hosted (same for every site, cached forever). On
  // EVERY host: the main host renders sites too (owner view, preview, /s/).
  if (method === "GET" && path === "/_f/wordmark.woff2") {
    return new Response(wordmarkFontBytes(), {
      headers: {
        "content-type": "font/woff2",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  }

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
    // A visitor leaving a review (same-origin form on the customer site).
    if (method === "POST" && path === "/review") return submitReview(request, env, slug);
    // Any other method: 405, never a redirect. A 302 to "/" keeps the method,
    // so a HEAD (before HEAD was routed as GET) looped on itself forever.
    if (method !== "GET") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
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
      if (site?.status === "live" && siteFileKeys(site).includes(key)) return photo(env, key, request);
      return new Response("Not found", { status: 404 });
    }
    const policyKind = policyPathKind(path);
    if (policyKind) return servePolicyPage(env, slug, site, policyKind);
    if (path !== "/") return Response.redirect(`https://${url.hostname}/`, 302);
    return serveSite(env, slug, site, { request, ctx, ping: true, count: !head });
  }

  if (method === "GET") {
    if (path === "/") {
      const cfg = billingConfig(env);
      const me = await currentAccount(env.SITES, request);
      const owner = me ? (await accountSites(env, me)).length > 0 : false;
      const admin = me ? isAdminEmail(env, me.email) : false;
      const n = nonce();
      return html(homePage(cfg.on, cfg.on && festiveOpen(cfg, new Date()) ? endOf(cfg.festiveUntil!) : null, owner, Boolean(me), admin, n, me?.email), 200, n);
    }
    if (path === "/new") {
      const me = await currentAccount(env.SITES, request);
      // One website per account (admins excepted): an owner who has one goes to it.
      if (me && !isAdminEmail(env, me.email) && (await accountSites(env, me)).length > 0)
        return Response.redirect(`${env.PUBLIC_ORIGIN}/account`, 302);
      return builder(env, { kind: "new", account: me, admin: me ? isAdminEmail(env, me.email) : false, publishesNow: newSitePublishes(env, me) });
    }
    if (path === "/login" || path === "/signup") {
      if (await currentAccount(env.SITES, request)) return Response.redirect(`${env.PUBLIC_ORIGIN}/account`, 302);
      return html(authPage(path === "/login" ? "login" : "signup", { next: url.searchParams.get("next") ?? undefined, reset: url.searchParams.get("reset") === "1" }));
    }
    if (path === "/forgot-password") {
      if (await currentAccount(env.SITES, request)) return Response.redirect(`${env.PUBLIC_ORIGIN}/account`, 302);
      return html(forgotPasswordPage());
    }
    if (path === "/reset-password") return html(resetPasswordPage({ token: url.searchParams.get("token") ?? undefined }));
    if (path === "/account") return accountHome(request, env, url);
    if (path === "/admin") return adminDashboard(request, env);
    if (path === "/privacy") return html(privacyPage());
    if (path === "/terms") return html(termsPage());
    if (path === "/contact") {
      const account = await currentAccount(env.SITES, request);
      return html(contactPage({ signedIn: account !== null, values: { email: shownEmail(account?.email) ?? "" } }));
    }
    if (path === "/faq") return html(faqPage(helpTopics(billingConfig(env), new Date()), (await currentAccount(env.SITES, request)) !== null));
    if (path === "/robots.txt") return new Response(`User-agent: *\nDisallow: /edit/\nDisallow: /api/\nDisallow: /admin\nDisallow: /account\n\nSitemap: ${env.PUBLIC_ORIGIN}/sitemap.xml\n`, { headers: { "content-type": "text/plain" } });
    if (path === "/sitemap.xml") {
      const urls = SITEMAP_PATHS.map((p) => `<url><loc>${esc(env.PUBLIC_ORIGIN + p)}</loc></url>`).join("");
      return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`, {
        headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    // The tab icon: an "S", matching AdVault's "A" (main site only; customer sites are the business's own).
    if (path === "/favicon.svg" || path === "/favicon.ico") {
      return new Response(FAVICON_SVG, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    }
    // PWA: the installable web manifest, the service worker, and the app icons.
    if (path === "/manifest.webmanifest") {
      return new Response(JSON.stringify(PWA_MANIFEST), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
    }
    // Android app (Trusted Web Activity, android/): proves the app owns this site so it opens full-screen with no URL bar.
    // Upload-key SHA-256; add the Play App Signing SHA-256 here once the app exists in Play Console.
    if (path === "/.well-known/assetlinks.json") {
      return new Response(JSON.stringify(ASSET_LINKS), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
    }
    if (path === "/helper.js") {
      const topics = helpTopics(billingConfig(env), new Date());
      const starters = STARTERS.map((id) => topics.find((t) => t.id === id)!).map(({ id, q }) => ({ id, q }));
      return new Response(helperScript(starters), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
    }
    if (path === "/panda-helper.webp") {
      return new Response(pngBytes(PANDA_WEBP), { headers: { "content-type": "image/webp", "cache-control": "public, max-age=604800" } });
    }
    if (path === "/sw.js") {
      return new Response(SERVICE_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "service-worker-allowed": "/" } });
    }
    // Share image for SiteVault's own pages (og:image). Main site only; customer sites have their own host and never reach here.
    if (path === "/og.png") {
      return new Response(pngBytes(OG_PNG), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (path in PWA_ICONS) {
      return new Response(pngBytes(PWA_ICONS[path]!), { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800, immutable" } });
    }
    if (path === "/metrics") return metrics(request, env);
    if (path === "/api/admin/sites") return adminList(request, env);
    if (path === "/api/address") return addressCheck(env, url);
    if (path === "/api/internal/resolve") return resolveInternal(request, env, url);
    if (path === "/api/internal/account-site") return accountSiteInternal(request, env, url);
    if (path === "/go/advault") return goAdvault(request, env, url, head);
    if (path === "/auth/handoff") return signinFromAdvault(request, env, url, head);
    if (path === "/embed/session") return embedSession(request, env, url, head);
    if (path === "/embed/new") return embedNew(request, env, url, head);
    if (path === "/embed/created") return embedCreated(request, env, url);
    let m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/offer-status$/);
    if (m) return offerStatusInternal(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/drafts\/([A-Za-z0-9_-]+)$/);
    if (m) return getDraftInternal(request, env, url, m[1]!);
    m = path.match(/^\/embed\/draft\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+\.(?:jpg|png|webp))$/);
    if (m) return embedDraftFile(request, env, m[1]!, m[2]!);
    m = path.match(/^\/s\/([a-z0-9-]+)\/?$/);
    // Old path links (before the customer-site domain) move to the subdomain.
    if (m) {
      const current = (await aliasTarget(env, m[1]!)) ?? m[1]!;
      return env.SITES_DOMAIN ? Response.redirect(siteUrl(env, current), 301) : serveSite(env, current, undefined, { request, ctx, ping: false, count: !head });
    }
    m = path.match(/^\/edit\/([a-z0-9-]+)\/view$/);
    if (m) return ownerView(request, env, m[1]!, url.searchParams.get("k") ?? "");
    m = path.match(/^\/edit\/([a-z0-9-]+)$/);
    if (m) {
      const target = (await env.SITES.get(siteKey(m[1]!))) ? null : await aliasTarget(env, m[1]!);
      const k = url.searchParams.get("k") ?? "";
      const embed = url.searchParams.get("embed") === "1";
      if (target) return Response.redirect(`${env.PUBLIC_ORIGIN}/edit/${target}?${embed ? "embed=1" : `k=${encodeURIComponent(k)}`}`, 302);
      if (embed) return embedEditPage(request, env, m[1]!, url.searchParams.get("saved") === "1");
      return editPage(request, env, m[1]!, k, url.searchParams.get("paid") === "1", url.searchParams.get("saved") === "1");
    }
    if (path.startsWith("/p/")) return photo(env, decodeURIComponent(path.slice(3)), request);
    m = path.match(/^\/done\/([A-Za-z0-9_-]+)$/);
    if (m) return done(request, env, m[1]!, !head);
  }

  if (method === "POST") {
    if (path === "/api/sites") return createSite(request, env, ctx);
    // Framable by our own pages only: the edit page's "Refresh preview" posts into its right-side view.
    if (path === "/preview") return allowSelfFraming(await previewSite(request, env, url));
    if (path === "/login" || path === "/signup") return authSubmit(request, env, ctx, path === "/login" ? "login" : "signup");
    if (path === "/logout") return logout(request, env);
    if (path === "/forgot-password") return forgotPasswordSubmit(request, env);
    if (path === "/contact") return contactSubmit(request, env);
    if (path === "/api/help") return helpAnswer(request, env);
    if (path === "/reset-password") return resetPasswordSubmit(request, env);
    if (path === "/account/change-password") return changePasswordSubmit(request, env);
    if (path === "/account/claim") return claimSite(request, env, ctx);
    if (path === "/api/internal/sites") return createInternal(request, env);
    if (path === "/api/internal/drafts") return createDraftInternal(request, env);
    if (path === "/api/embed/sites") return embedCreate(request, env);
    // TODO(android-payments): no payments from inside the Android app (app.ts).
    if ((path === "/api/billing/checkout" || path === "/api/billing/portal") && isAppRequest(request)) return appPaymentsBlocked();
    if (path === "/api/billing/checkout") return billingCheckout(request, env);
    if (path === "/api/billing/portal") return billingPortal(request, env);
    if (path === "/webhooks/stripe") return stripeWebhook(request, env);
    let m = path.match(/^\/api\/sites\/([a-z0-9-]+)$/);
    if (m) return updateSite(request, env, m[1]!);
    m = path.match(/^\/api\/sites\/([a-z0-9-]+)\/menu$/);
    if (m) return uploadMenu(request, env, m[1]!);
    m = path.match(/^\/api\/sites\/([a-z0-9-]+)\/reviews$/);
    if (m) return moderateReviews(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/offer$/);
    if (m) return setOfferInternal(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/paid$/);
    if (m) return paidInternal(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/plan-cover$/);
    if (m) return planCoverInternal(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/owner$/);
    if (m) return ownerInternal(request, env, m[1]!);
    m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)\/video$/);
    if (m) return videoInternal(request, env, m[1]!);
    m = path.match(/^\/api\/admin\/sites\/([a-z0-9-]+)\/remove$/);
    if (m) return adminRemove(request, env, m[1]!);
  }

  if (method === "DELETE") {
    const m = path.match(/^\/api\/internal\/sites\/([a-z0-9-]+)$/);
    if (m) return deleteInternal(request, env, url, m[1]!);
  }

  return html(messagePage("Page not found", "There's nothing at this address."), 404);
}

// ---------------------------------------------------------------------------
// Responses

function nonce(): string {
  return randomKey(16);
}

function html(page: string, status = 200, pageNonce?: string): Response {
  // Pages with the panda helper (pages.ts HELPER_MARK) load its script with a nonce too.
  const helper = page.includes(HELPER_MARK);
  const scriptNonce = pageNonce ?? (helper ? nonce() : undefined);
  const body = helper ? page.replace(HELPER_MARK, `<script nonce="${scriptNonce}" src="/helper.js" defer></script>`) : page;
  const csp = [
    "default-src 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "style-src 'unsafe-inline'",
    // Self-hosted wordmark font (served from this origin at /_f/wordmark.woff2).
    "font-src 'self'",
    scriptNonce ? `script-src 'nonce-${scriptNonce}'` : "script-src 'none'",
    // PWA: allow the installable manifest and the same-origin service worker.
    "manifest-src 'self'",
    "worker-src 'self'",
    // counts.* is our own visit counter (helper-client.ts), on pages with the helper only.
    helper ? "connect-src 'self' https://counts.3pandalabs.com" : "connect-src 'self'",
    // Stripe hosts so a browser follows the checkout/portal form POST's 303 to
    // Stripe — form-action is enforced against the redirect target, not just
    // the POST URL, so 'self' alone silently blocks publishing and billing.
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
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

/** Taken by a site, held by a renamed site as its old address, or just reserved. */
async function addressTaken(env: Env, slug: string): Promise<boolean> {
  if ((await env.SITES.get(siteKey(slug))) || (await env.SITES.get(aliasKey(slug)))) return true;
  const held = await env.PHOTOS.head(addrKey(slug));
  return held !== null && freshHold(held);
}

// Address reservations: R2 `addr/<slug>`. KV can't decide who gets an address:
// it has no create-if-absent, and a "not found" read is cached for up to 60 s
// per location, so two owners could both see an address free and the second
// save would replace the first one's website. R2 is strongly consistent and a
// conditional put is atomic, so exactly one request wins. Every NEW address
// (create, default, rename) is reserved before anything is stored.
// KV stays the long-term record: after ADDRESS_HOLD_MS (far longer than KV
// takes to settle) a reservation with no site or alias behind it is a leftover
// of a failed request and may be taken over. So sites made before this need no
// reservation, and no backfill.
const addrKey = (slug: string) => `addr/${slug}`;
const ADDRESS_HOLD_MS = 10 * 60 * 1000;
const freshHold = (o: R2Object) => Date.now() - o.uploaded.getTime() < ADDRESS_HOLD_MS;

/** Reserve an address, atomically. False = taken, or someone else just got it. */
async function reserveAddress(env: Env, slug: string): Promise<boolean> {
  if (await addressTaken(env, slug)) return false;
  // Random body: every reservation has its own etag.
  const put = (onlyIf: R2Conditional | Headers) => env.PHOTOS.put(addrKey(slug), randomKey(16), { onlyIf });
  if ((await put(new Headers({ "if-none-match": "*" }))) !== null) return true;
  const held = await env.PHOTOS.head(addrKey(slug));
  if (!held || freshHold(held)) return false;
  return (await put({ etagMatches: held.etag })) !== null;
}

/** Give a reservation back (nothing was made under it, or its site is gone). */
async function releaseAddress(env: Env, ...slugs: string[]): Promise<void> {
  try {
    await env.PHOTOS.delete(slugs.map(addrKey));
  } catch (err) {
    console.warn("address release failed", String(err));
  }
}

const ADDRESS_TAKEN = "That address is taken. Try another.";

/** The address for a new site, reserved: the requested one (null if taken), else the first free default. */
async function reserveNewAddress(env: Env, content: SiteContent, requested: string | null): Promise<string | null> {
  if (requested) return (await reserveAddress(env, requested)) ? requested : null;
  return uniqueSlug(env, content.businessName, content.category, content.city);
}

/** Reserves the first free default (name, name-type, name-town), else name-2, name-3… */
async function uniqueSlug(env: Env, businessName: string, category: string, city: string): Promise<string> {
  const suggestions = suggestAddresses(businessName, category, city);
  for (const s of suggestions) if (await reserveAddress(env, s)) return s;
  const base = suggestions[0] ?? "my-business";
  for (let i = 2; i < 30; i += 1) {
    const candidate = `${base}-${i}`.slice(0, MAX_LEN);
    if (addressProblem(candidate) === null && (await reserveAddress(env, candidate))) return candidate;
  }
  return `${base.slice(0, 30)}-${randomKey(6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

/** Checks a requested address; null when it can be used. */
async function requestedAddressProblem(env: Env, slug: string): Promise<string | null> {
  return addressProblem(slug) ?? ((await addressTaken(env, slug)) ? ADDRESS_TAKEN : null);
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

// POST /api/internal/sites/<slug>/owner  { advaultUserId, email }
// Puts an AdVault-made site on its owner's SiteVault account (AdVault backfills
// sites made before accounts). Never moves a site that already has an owner.
async function ownerInternal(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  let body: { advaultUserId?: unknown; email?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const advaultUserId = typeof body.advaultUserId === "string" && /^[A-Za-z0-9-]{8,64}$/.test(body.advaultUserId) ? body.advaultUserId : null;
  const email = normaliseEmail(typeof body.email === "string" ? body.email : "");
  // No email (or a test customer's *.invalid one) = linked by the AdVault user id alone.
  if (!advaultUserId || (email && emailProblem(email))) return json({ ok: false, error: "invalid" }, 400);
  const site = await liveSiteFollowingAliases(env, slug);
  if (!site) return json({ ok: false, error: "not_found" }, 404);
  if (site.source !== "advault") return json({ ok: false, error: "not_an_advault_site" }, 409);
  const account = await accountForAdvault(env.SITES, { advaultUserId, email });
  if (site.ownerId && site.ownerId !== account.id) return json({ ok: false, error: "owned_by_another_account" }, 409);
  if (!site.ownerId) await saveSite(env, { ...site, ownerId: account.id, updatedAt: new Date().toISOString() });
  await addSiteToAccount(env.SITES, account, site.slug);
  return json({ ok: true, slug: site.slug });
}

// POST /api/internal/sites/<slug>/video  multipart field "video" (MP4, <= 40 MB)
// AdVault puts the ad on an AdVault-made site when the ad launches (it no
// longer sends it when the site is made). Replaces any earlier video; the old
// file is deleted after the site points at the new one.
async function videoInternal(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const form = await readForm(request);
  const video = form?.video ?? null;
  if (!video || video.type !== "video/mp4" || video.size > MAX_VIDEO_BYTES) return json({ ok: false, error: "invalid_video" }, 400);
  const site = await liveSiteFollowingAliases(env, slug);
  if (!site) return json({ ok: false, error: "not_found" }, 404);
  if (site.source !== "advault") return json({ ok: false, error: "not_an_advault_site" }, 409);
  const key = await storeVideo(env, site.slug, video);
  // Re-read right before saving so a concurrent edit isn't clobbered.
  const fresh = (await loadSite(env, site.slug)) ?? site;
  await saveSite(env, { ...fresh, video: key, updatedAt: new Date().toISOString() });
  if (fresh.video && fresh.video !== key) await deletePhotos(env, [fresh.video]);
  console.log("site_video_set", { slug: site.slug });
  return json({ ok: true, slug: site.slug });
}

const paidRefKey = (ref: string) => `paidref:${ref}`;

// POST /api/internal/sites/<slug>/paid  { ref }
// AdVault charged its $10 website fee for a site made with awaitingPayment:
// publish it with a year of Pro. Idempotent on ref (AdVault's purchase id).
async function paidInternal(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  let body: { ref?: unknown };
  try {
    body = (await request.json()) as { ref?: unknown };
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const ref = typeof body.ref === "string" && /^[A-Za-z0-9_-]{6,80}$/.test(body.ref) ? body.ref : null;
  if (!ref) return json({ ok: false, error: "invalid", detail: "ref required" }, 400);
  const site = await liveSiteFollowingAliases(env, slug);
  if (!site) return json({ ok: false, error: "not_found" }, 404);
  const done = { ok: true, slug: site.slug, siteUrl: siteUrl(env, site.slug) };
  if (await env.SITES.get(paidRefKey(ref))) return json(done);
  // BILLING off: nothing to unlock (the site is already live).
  if (site.billing) {
    const fresh = (await loadSite(env, site.slug)) ?? site;
    await saveSite(env, { ...fresh, billing: applyAdvaultPaid(billingOf(fresh), new Date()), updatedAt: new Date().toISOString() });
  }
  await env.SITES.put(paidRefKey(ref), "1", { expirationTtl: 400 * 24 * 60 * 60 });
  console.log("advault_paid", { slug: site.slug, ref });
  return json(done);
}

// POST /api/internal/sites/<slug>/plan-cover  { until, ref }
// The owner's AdVault plan is running: keep this AdVault-made site on Pro to
// the end of the plan's paid period. Only moves forward (applyPlanCover), so
// it is idempotent by itself; `ref` is only logged. Never publishes a site
// whose $10 is unpaid.
async function planCoverInternal(request: Request, env: Env, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  let body: { until?: unknown; ref?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const until = planCoverUntil(body.until, new Date());
  if (!until) return json({ ok: false, error: "invalid", detail: "until" }, 400);
  const site = await liveSiteFollowingAliases(env, slug);
  if (!site) return json({ ok: false, error: "not_found" }, 404);
  if (site.source !== "advault") return json({ ok: false, error: "not_an_advault_site" }, 409);
  // Re-read right before saving so a payment landing now isn't clobbered.
  const fresh = (await loadSite(env, site.slug)) ?? site;
  const b = billingOf(fresh);
  if (b.status === "pending") return json({ ok: false, error: "not_paid" }, 409);
  const next = applyPlanCover(b, until);
  // BILLING off or comped: nothing to pay, so nothing to cover.
  if (billingConfig(env).on && !b.comp && (next.paidUntil !== b.paidUntil || next.planCoveredUntil !== b.planCoveredUntil || next.plan !== b.plan)) {
    await saveSite(env, { ...fresh, billing: next, updatedAt: new Date().toISOString() });
    console.log("plan_cover", { slug: fresh.slug, until: next.paidUntil, ref: typeof body.ref === "string" ? body.ref.slice(0, 120) : null });
  }
  return json({ ok: true, slug: fresh.slug, paidUntil: next.paidUntil });
}

// DELETE /api/internal/sites/<slug>?advaultUserId=&email=  (INTERNAL_TOKEN)
// AdVault's admin-only "Delete it and make a new one" (AdVault checks the
// REAL admin role; this route trusts the token). Unlike the ops takedown
// (removeSite keeps a `removed` record so the slug is never reused), this
// deletes the site for good: photos, video and before & after files, the
// site record, every old address (alias), the phone and name/town index, the
// account link and its visit stats, so the address, the phone and the
// account's one-website slot are all free for a new site. Idempotent: an
// unknown address answers ok with deleted false. Refuses a site owned by
// another account (403 not_your_site) and one with a renewing Stripe
// subscription (409 has_subscription: cancel it first). An ops takedown
// (status removed) is left alone (abuse trail).
async function deleteInternal(request: Request, env: Env, url: URL, slug: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const advaultUserId = url.searchParams.get("advaultUserId") ?? "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(advaultUserId)) return json({ ok: false, error: "invalid" }, 400);
  const current = (await env.SITES.get(siteKey(slug))) ? slug : await aliasTarget(env, slug);
  const site = current ? await loadSite(env, current) : null;
  if (!site) return json({ ok: true, slug, deleted: false });
  if (site.status === "removed") return json({ ok: true, slug: site.slug, deleted: false, removed: true });
  const account = await findAccountForAdvault(env.SITES, { advaultUserId, email: url.searchParams.get("email") });
  // Owned: only by this account. Unowned: only an AdVault-made site (older
  // sites made before accounts; AdVault only sends its own campaign's link).
  const allowed = site.ownerId ? site.ownerId === account?.id : site.source === "advault";
  if (!allowed) return json({ ok: false, error: "not_your_site" }, 403);
  if (site.billing?.subscriptionId && site.billing.renewing) return json({ ok: false, error: "has_subscription" }, 409);

  await deletePhotos(env, siteFileKeys(site));
  await unindexSite(env, site);
  const old = site.aliases ?? [];
  for (const a of old) if ((await env.SITES.get(aliasKey(a))) === site.slug) await env.SITES.delete(aliasKey(a));
  await env.SITES.delete(siteKey(site.slug));
  await releaseAddress(env, site.slug, ...old);
  const owner = site.ownerId ? await loadAccount(env.SITES, site.ownerId) : null;
  if (owner) {
    const gone = new Set([site.slug, slug, ...old]);
    await saveAccount(env.SITES, { ...owner, sites: owner.sites.filter((s) => !gone.has(s)) });
  }
  if (env.STATS) {
    try {
      await env.STATS.prepare("DELETE FROM daily WHERE slug = ?").bind(site.slug).run();
    } catch (err) {
      console.warn("stats delete failed", String(err));
    }
  }
  console.log("site_deleted_internal", { slug: site.slug, aliases: old.length, advaultUserId });
  return json({ ok: true, slug: site.slug, deleted: true });
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
  visit: { request: Request; ctx: ExecutionContext; ping: boolean; count?: boolean },
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
  // Preview a style and/or brand colour without saving (owner clicks "Preview
  // this style" on the edit page): `?style=<key>` and/or `?brand=<#rrggbb>`.
  const previewParams = new URL(visit.request.url).searchParams;
  const style = previewParams.get("style") ?? undefined;
  const previewBrand = asBrandColor(previewParams.get("brand"));
  const isPreview = Boolean(style) || Boolean(previewBrand);
  if (visit.count !== false && countsVisits(site, cfg, now) && !isPreview) countView(env, visit.ctx, visit.request, site);
  const n = nonce();
  const res = html(renderSite(site, { ...renderCtx(env, slug), ping: visit.ping && Boolean(env.STATS) && !isPreview, previewTemplate: style, previewBrandColor: previewBrand ?? undefined, nonce: n }), 200, n);
  if (isPreview) {
    res.headers.set("x-robots-tag", "noindex");
    res.headers.set("cache-control", "no-store");
  } else {
    // Always revalidate so an owner's edit shows on the very next refresh (a 60s
    // browser cache made edits take up to a minute to appear). Ad-traffic spikes
    // are still cheap: Workers KV edge-caches the hot site record per colo, so
    // repeated views don't hit KV origin.
    res.headers.set("cache-control", "public, max-age=0, must-revalidate");
  }
  return res;
}

/**
 * A customer site's legal/policy page (/privacy, /accessibility, /cookies,
 * /terms). Same availability gating as the site itself: a removed site 404s, an
 * unpublished or paused one shows the hold page (noindex), so policy pages never
 * leak a site that isn't live.
 */
async function servePolicyPage(env: Env, slug: string, preloaded: Site | null | undefined, kind: PolicyKind): Promise<Response> {
  const site = preloaded !== undefined ? preloaded : await loadSite(env, slug);
  if (!site || site.status !== "live") {
    return html(messagePage("This website isn't available", "It may have been removed by its owner."), 404);
  }
  const cfg = billingConfig(env);
  const state = siteState(site, cfg, new Date());
  if (state === "unpublished" || state === "paused") {
    const res = html(renderHold(site, state));
    res.headers.set("x-robots-tag", "noindex");
    return res;
  }
  const res = html(renderPolicyPage(site, kind, renderCtx(env, slug)));
  res.headers.set("cache-control", "public, max-age=0, must-revalidate");
  return res;
}

/**
 * The "your site is live" page after a script-driven create (10-minute
 * handoff). ONE-TIME: it carries the only copy of the edit key, so the
 * handoff is deleted on the first read (a HEAD doesn't use it up); a reload
 * gets the expired page.
 */
async function done(request: Request, env: Env, handoff: string, consume = true): Promise<Response> {
  const key = `done:${handoff}`;
  const data = await env.SITES.get<{ siteUrl: string; editUrl: string; publish?: Parameters<typeof donePage>[0]["publish"] }>(key, "json");
  if (!data) return html(messagePage("This page has expired", "Open your website or your edit link directly.", "Expired"), 404);
  if (consume) await env.SITES.delete(key);
  const account = await currentAccount(env.SITES, request);
  const n = nonce();
  const res = html(donePage({ ...data, nonce: n, signedIn: Boolean(account), admin: isAdminEmail(env, account?.email) }), 200, n);
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

function builder(_env: Env, mode: Parameters<typeof builderPage>[0], errors?: FieldErrors, values?: Record<string, string>, status = 200): Response {
  const n = nonce();
  const res = html(builderPage(mode, n, errors, values, _env.SITES_DOMAIN ?? null), status, n);
  if ((mode.kind === "edit" && mode.embed) || (mode.kind === "new" && mode.embedDraft)) return allowEmbedFraming(res);
  // The tabbed edit page frames its own right-side view (same origin only);
  // it still can't be framed itself (frame-ancestors 'none').
  if (mode.kind === "edit") res.headers.set("content-security-policy", `${res.headers.get("content-security-policy")}; frame-src 'self'`);
  return res;
}

/** A plain message page that AdVault may frame (the embed flow's errors). */
function embedMessage(title: string, message: string, status: number): Response {
  return allowEmbedFraming(html(messagePage(title, message, title), status));
}

// ---------------------------------------------------------------------------
// Customer reviews (visitor-submitted, owner-moderated)

const pendingReviewKey = (slug: string, id: string) => `revq:${slug}:${id}`;

/** Reviews awaiting the owner's moderation, newest first. */
async function listPendingReviews(env: Env, slug: string): Promise<Review[]> {
  const list = await env.SITES.list({ prefix: `revq:${slug}:` });
  const out: Review[] = [];
  for (const k of list.keys) {
    const v = await env.SITES.get(k.name);
    if (v) out.push(JSON.parse(v) as Review);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function reviewRateLimited(request: Request, env: Env, slug: string): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `rrl:${slug}:${await sha256Hex(`${ip}:${Math.floor(Date.now() / 86_400_000)}`)}`;
  const n = Number((await env.SITES.get(key)) ?? "0");
  if (n >= REVIEWS_PER_IP_PER_DAY) return true;
  await env.SITES.put(key, String(n + 1), { expirationTtl: 86_400 });
  return false;
}

// POST /review on a customer site. Stored pending until the owner approves.
// Honeypot + per-IP rate limit; a dropped submission still gets a friendly
// thanks, so neither a bot nor a rate-limited visitor learns why.
async function submitReview(request: Request, env: Env, slug: string): Promise<Response> {
  const site = await loadSite(env, slug);
  if (!site || site.status !== "live") return new Response("Not found", { status: 404 });
  const thanks = (msg: string, status = 200) => html(reviewResultPage(siteUrl(env, slug), site.businessName, msg), status);
  const form = await readForm(request);
  if (!form) return thanks("Something went wrong — please try again.", 400);
  if ((form.fields.website ?? "").trim()) return thanks("Thanks for your review!"); // honeypot
  if (await reviewRateLimited(request, env, slug)) return thanks("Thanks — you've already shared a review recently.");
  const parsed = parseReviewSubmission(form.fields);
  if (!parsed.ok) return thanks(parsed.error, 400);
  if ((await listPendingReviews(env, slug)).length >= MAX_PENDING_REVIEWS) return thanks("Thanks for your review!");
  const review: Review = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...parsed.value };
  await env.SITES.put(pendingReviewKey(slug, review.id), JSON.stringify(review), { expirationTtl: 90 * 86_400 });
  return thanks("Thanks! Your review will appear on the site once it's approved.");
}

// Owner moderates from the edit page: approve / reject a pending review, or
// remove an approved one. Authed by the edit key or an owner session.
async function moderateReviews(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  const key = form?.fields.key ?? "";
  const site = await authorize(env, slug, key, request);
  if (!site) return redirectTo(env, "/login");
  const action = form?.fields.action ?? "";
  const reviewId = form?.fields.reviewId ?? "";
  const embed = form?.fields.embed === "1";
  if (action === "approve" && reviewId) {
    const raw = await env.SITES.get(pendingReviewKey(slug, reviewId));
    if (raw) {
      const review = JSON.parse(raw) as Review;
      const reviews = [review, ...(site.reviews ?? [])].slice(0, MAX_APPROVED_REVIEWS);
      await saveSite(env, { ...site, reviews, updatedAt: new Date().toISOString() });
      await env.SITES.delete(pendingReviewKey(slug, reviewId));
    }
  } else if (action === "reject" && reviewId) {
    await env.SITES.delete(pendingReviewKey(slug, reviewId));
  } else if (action === "remove" && reviewId) {
    const reviews = (site.reviews ?? []).filter((r) => r.id !== reviewId);
    await saveSite(env, { ...site, reviews: reviews.length ? reviews : undefined, updatedAt: new Date().toISOString() });
  }
  return redirectTo(env, `/edit/${encodeURIComponent(slug)}${embed ? "?embed=1" : `?k=${encodeURIComponent(key)}`}`);
}

/**
 * Back from Stripe Checkout (success_url carries session_id): verify the session
 * and apply the payment right away, so a slightly-delayed webhook can't leave the
 * owner on an "unpublished / pay to publish" page. Idempotent with the webhook
 * (applyEvent is; credits are left to the webhook, which dedups them). Best
 * effort: any Stripe hiccup falls through and the webhook still publishes.
 */
async function finalizeCheckoutOnReturn(request: Request, env: Env, site: Site): Promise<Site> {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  const cfg = billingConfig(env);
  if (!sessionId || !env.STRIPE_SECRET_KEY || !cfg.on) return site;
  // Only pay the Stripe round-trip when publishing would actually change something.
  if (siteState(site, cfg, new Date()) === "live") return site;
  try {
    const session = await retrieveCheckoutSession(env.STRIPE_SECRET_KEY, sessionId);
    const ev = eventFromStripe({ type: "checkout.session.completed", data: { object: session } });
    // A paid publish/renew for THIS site only. Credits aren't idempotent across
    // this path and the webhook and don't publish anything, so leave them to it.
    if (!ev || ev.type !== "checkout_completed" || ev.kind === "credits") return site;
    if (ev.slug !== site.slug && (await aliasTarget(env, ev.slug)) !== site.slug) return site;
    // Re-read the freshest copy so a racing webhook write isn't clobbered.
    const fresh = (await loadSite(env, site.slug)) ?? site;
    const { billing, cancel } = applyEvent(billingOf(fresh), ev, new Date());
    await saveSite(env, { ...fresh, billing });
    if (cancel) cancelSubscription(env.STRIPE_SECRET_KEY, cancel).catch((e) => console.warn("cancel on return failed", String(e)));
    console.log("checkout_finalized_on_return", { slug: fresh.slug, plan: billing.plan, paidUntil: billing.paidUntil });
    return { ...fresh, billing };
  } catch (err) {
    console.warn("finalize on return failed", String(err));
    return site;
  }
}

async function editPage(request: Request, env: Env, slug: string, key: string, justPaid = false, saved = false): Promise<Response> {
  const authed = await authorize(env, slug, key, request);
  if (!authed) {
    // No key: send them to sign in, then back here.
    if (!key && !(await currentAccount(env.SITES, request))) return Response.redirect(`${env.PUBLIC_ORIGIN}/login?next=/edit/${slug}`, 302);
    return html(messagePage("Edit link not valid", "Check you copied the whole link, or sign in to the account that owns this website. Lost it? Email sitevault@3pandalabs.com.", "Can't open"), 403);
  }
  const site = await finalizeCheckoutOnReturn(request, env, authed);
  const signedIn = Boolean(await currentAccount(env.SITES, request));
  return builder(env, { ...(await editMode(env, site, key, justPaid)), signedIn, saved });
}

/**
 * GET /edit/<slug>/view  The edit page's right-side view ("View your
 * website"): the SAVED site rendered for its owner (edit key or session),
 * published or not, inside the edit page's iframe. Same origin as the editor,
 * so photos come from this origin's /p/ (the customer host's CSP and
 * frame-ancestors stay untouched: customer sites are never framed). Never
 * counts a visit, never pings, noindex, no-store; framable by our own pages
 * only (frame-ancestors 'self').
 */
async function ownerView(request: Request, env: Env, slug: string, key: string): Promise<Response> {
  const site = await authorize(env, slug, key, request);
  if (!site) return allowSelfFraming(html(messagePage("Sign in to see this", "Open your website from My website to see it here.", "Can't open"), 403));
  const state = siteState(site, billingConfig(env), new Date());
  const n = nonce();
  const ctx = { ...renderCtx(env, site.slug), assetOrigin: env.PUBLIC_ORIGIN, ping: false, nonce: n };
  const live = state === "live" || state === "grace";
  const note = live
    ? `Your website as saved. It is live at ${ctx.siteUrl.replace(/\/$/, "")}.`
    : state === "paused"
      ? "Your website is paused: visitors see a short notice until you renew. This is how it looks."
      : "Not published yet: this is how your website will look.";
  const res = html(ownerFrame(renderSite(site, ctx), note, ctx.siteUrl), 200, n);
  res.headers.set("x-robots-tag", "noindex");
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return allowSelfFraming(res);
}

/**
 * A rendered site shown inside the editor (owner view and preview): a status
 * bar, noindex, and links that leave the frame (new tab), with root-relative
 * links (policy pages) pointed at the customer site, not SiteVault.
 */
function ownerFrame(page: string, notes: string | string[], siteUrl: string): string {
  const origin = new URL(siteUrl).origin;
  const bar = `<div role="status" style="position:sticky;top:0;z-index:9999;background:#111827;color:#fff;font:600 14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:10px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">${(Array.isArray(notes) ? notes : [notes]).map((t, i) => (i === 0 ? `<span>${esc(t)}</span>` : `<span style="display:block;font-weight:400;opacity:.85">${esc(t)}</span>`)).join("")}</div>`;
  let out = page.includes('<meta name="robots"') ? page : page.replace("<head>", '<head><meta name="robots" content="noindex">');
  out = out.replace(/(<a\b[^>]*?\bhref=")\/(?!\/)/g, `$1${origin}/`);
  out = out.replace(/<a\b(?=[^>]*\bhref="https?:)(?![^>]*\btarget=)/g, '<a target="_blank" rel="noopener"');
  return out.replace(/<body([^>]*)>/, (m) => `${m}${bar}`);
}

/** frame-ancestors 'self': only SiteVault's own pages may frame this (owner view, preview). */
function allowSelfFraming(res: Response): Response {
  const csp = res.headers.get("content-security-policy");
  if (csp) res.headers.set("content-security-policy", csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'"));
  return res;
}

// ---------------------------------------------------------------------------
// Embedded editor (embed.ts): AdVault's "Your website" page frames the edit
// page. AdVault-made sites only (AdVault covers their website, so no
// SiteVault billing is shown); the owner's session only (never an edit key
// in the frame's URL); never a sign-in form: an expired session says to
// reopen the page in AdVault, which mints a fresh handoff.

const EMBED_EXPIRED = "Go back to AdVault and open Your website again.";

async function embedEditPage(request: Request, env: Env, slug: string, saved: boolean): Promise<Response> {
  const site = await authorize(env, slug, "", request);
  if (!site) return embedMessage("Please reopen", EMBED_EXPIRED, 403);
  if (site.source !== "advault") return embedMessage("Edit on SiteVault", "This website was made on SiteVault. Edit it at sitevault.3pandalabs.com.", 409);
  return builder(env, { ...(await editMode(env, site, "", false, true)), signedIn: true, embed: true, saved });
}

/**
 * GET /embed/session?token=  AdVault's sign-in handoff (embed.ts has the
 * format). Valid signature, at most 60 s old, never used before (KV
 * `embedjti:`), and the AdVault user's account owns this AdVault-made site:
 * then the normal session cookie and a redirect to the embed editor.
 */
async function embedSession(request: Request, env: Env, url: URL, head: boolean): Promise<Response> {
  const fail = () => embedMessage("Please reopen", `This link has expired. ${EMBED_EXPIRED}`, 403);
  const checked = await verifyHandoff(env.INTERNAL_TOKEN, url.searchParams.get("token") ?? "");
  if (!checked.ok) {
    if (checked.error === "not_configured") return embedMessage("Not available", "Editing from AdVault isn't switched on yet.", 503);
    console.warn("embed_handoff_refused", { reason: checked.error });
    return fail();
  }
  const h = checked.handoff;
  // A link checker's HEAD must not use the token up.
  if (head) return embedMessage("Opening your editor", "One moment.", 200);
  const jtiKey = `embedjti:${h.jti}`;
  if (await env.SITES.get(jtiKey)) {
    console.warn("embed_handoff_refused", { reason: "reused" });
    return fail();
  }
  await env.SITES.put(jtiKey, "1", { expirationTtl: HANDOFF_JTI_TTL_SECONDS });
  const account = await findAccountForAdvault(env.SITES, { advaultUserId: h.uid, email: h.email });
  const site = account ? await ownedSite(env, account, h.slug) : null;
  if (!account || !site || site.source !== "advault") {
    console.warn("embed_handoff_refused", { reason: "not_owner", slug: h.slug });
    return fail();
  }
  const res = redirectTo(env, `/edit/${encodeURIComponent(site.slug)}?embed=1`, sessionCookie(await startSession(env.SITES, account.id)));
  res.headers.set("referrer-policy", "no-referrer");
  res.headers.set("cache-control", "no-store");
  return res;
}

// ---------------------------------------------------------------------------
// One-tap sign-in between SiteVault and AdVault (2026-11-20, signin.ts has the
// token format). Admins are refused both ways (they sign in by hand). Any
// failure lands on the normal sign-in page, never an error that says why.

function noStoreRedirect(location: string, status = 302, cookie?: string): Response {
  const res = new Response(null, { status, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  if (cookie) res.headers.append("set-cookie", cookie);
  return res;
}

/**
 * GET /go/advault?to=<AdVault path>  "Video ads" / "Make a YouTube ad" for a
 * signed-in owner whose account is linked to an AdVault user: mint a 60 s,
 * single-use "signin-advault" token and send them to AdVault's /auth/handoff,
 * which signs them in to the same account. Not signed in, not linked, an
 * id-only test account, an admin, or no INTERNAL_TOKEN: the plain AdVault page
 * (AdVault asks them to sign in as usual). HEAD mints nothing.
 */
async function goAdvault(request: Request, env: Env, url: URL, head: boolean): Promise<Response> {
  const to = safeLocalPath(url.searchParams.get("to"), "/dashboard");
  const plain = noStoreRedirect(`${ADVAULT_WEB_ORIGIN}${to}`);
  if (head || !env.INTERNAL_TOKEN) return plain;
  const me = await currentAccount(env.SITES, request);
  if (!me || !me.advaultUserId || isIdOnlyAccount(me) || isAdminEmail(env, me.email)) return plain;
  const token = await mintSigninToken(env.INTERNAL_TOKEN, "signin-advault", { uid: me.advaultUserId, email: me.email });
  return noStoreRedirect(`${ADVAULT_WEB_ORIGIN}/auth/handoff?t=${encodeURIComponent(token)}&to=${encodeURIComponent(to)}`);
}

/**
 * GET /auth/handoff?t=&to=  AdVault's "signin-sitevault" token (AdVault
 * POST /auth/sitevault-handoff). Valid signature and purpose, at most 60 s
 * old, never used before (KV `signinjti:`), and the account linked to that
 * AdVault user id (`acctadv:` only: never found, created or merged by email)
 * with the same email (an id-only test account: no email) and not an admin:
 * then the normal session cookie and a 303 to `to` (a local path; default
 * /account). Anything else: /login?next=<to>. HEAD never uses a token up.
 */
async function signinFromAdvault(request: Request, env: Env, url: URL, head: boolean): Promise<Response> {
  const to = safeLocalPath(url.searchParams.get("to"), "/account");
  const toLogin = (reason: string) => {
    console.warn("signin_handoff_refused", { reason });
    return noStoreRedirect(`${env.PUBLIC_ORIGIN}/login?next=${encodeURIComponent(to)}`, 303);
  };
  const checked = await verifySigninToken(env.INTERNAL_TOKEN, url.searchParams.get("t") ?? "", "signin-sitevault");
  if (!checked.ok) return toLogin(checked.error);
  const t = checked.token;
  if (head) return html(messagePage("Signing you in", "One moment.", "Signing you in"), 200);
  const nonceKey = `signinjti:${t.nonce}`;
  if (await env.SITES.get(nonceKey)) return toLogin("reused");
  await env.SITES.put(nonceKey, "1", { expirationTtl: SIGNIN_NONCE_TTL_SECONDS });
  const account = await accountByAdvaultId(env.SITES, t.uid);
  if (!account) return toLogin("no_account");
  if (isAdminEmail(env, account.email) || isAdminEmail(env, t.email)) return toLogin("admin");
  const emailOk = isIdOnlyAccount(account) ? advaultLinkEmail(t.email) === "" : normaliseEmail(t.email) === account.email;
  if (!emailOk) return toLogin("email_mismatch");
  return noStoreRedirect(`${env.PUBLIC_ORIGIN}${to}`, 303, sessionCookie(await startSession(env.SITES, account.id)));
}

// ---------------------------------------------------------------------------
// AdVault create mode (2026-11-19): AdVault's "Make me a website" frames the
// FULL builder, pre-filled from the campaign (drafts.ts has the pre-fill
// store, embed.ts the create token). Flow:
//   1. AdVault  POST /api/internal/drafts         (INTERNAL_TOKEN) -> draftId
//   2. AdVault  mints a 60 s single-use create token naming the draft
//   3. iframe   GET /embed/new?token=             -> session cookie, 303 to
//               GET /embed/new?draft=<id>         the builder in embed chrome
//   4. owner    POST /api/embed/sites             -> the normal AdVault create
//               (createForAdvault), then /embed/created posts
//               {type:"sitevault:created"} to AdVault's origin only
//   5. AdVault  GET /api/internal/drafts/<id>     (INTERNAL_TOKEN) to verify
//               the result server side before it trusts the message
// Every response on these routes may be framed by AdVault only
// (allowEmbedFraming); every other page keeps frame-ancestors 'none'.

const EMBED_CREATE_EXPIRED = "Go back to AdVault and press Make me a website again.";

/** POST /api/internal/drafts  AdVault stores the pre-fill (multipart, like internal create). */
async function createDraftInternal(request: Request, env: Env): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const form = await readForm(request);
  if (!form) return json({ ok: false, error: "bad_request" }, 400);
  const uid = form.fields.ownerAdvaultUserId ?? "";
  // "" for an AdVault test customer (no email, or its *.invalid one): the
  // builder then links the account by the AdVault user id alone.
  const email = advaultLinkEmail(form.fields.ownerEmail);
  const campaignId = form.fields.campaignId ?? "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(uid) || !/^[A-Za-z0-9-]{8,64}$/.test(campaignId)) return json({ ok: false, error: "bad_request" }, 400);
  const errors: FieldErrors = {};
  const photoErr = checkPhotos(form.files, 0, INTERNAL_PHOTO_BYTES);
  if (photoErr) errors.photos = photoErr;
  const pairs = pickBeforeAfter(form.ba, { existing: 0, types: INTERNAL_BEFORE_AFTER_TYPES, maxBytes: INTERNAL_PHOTO_BYTES });
  if (!pairs.ok) errors.beforeAfter = pairs.error;
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) errors.video = "Video must be an MP4 under 40 MB.";
  if (Object.keys(errors).length > 0) return json({ ok: false, error: "invalid", errors }, 400);
  const id = randomKey(18);
  const put = async (f: File, resize: boolean) => {
    const { bytes, type } = resize ? await webSize(env, f) : { bytes: await f.arrayBuffer(), type: f.type };
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : type === "video/mp4" ? "mp4" : "jpg";
    const key = `drafts/${id}/${randomKey(9)}.${ext}`;
    await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
    return { key, type };
  };
  const photos = [];
  for (const f of form.files) photos.push(await put(f, true));
  const pairFiles = [];
  for (const [b, a] of pairs.ok ? pairs.pairs : []) pairFiles.push({ before: await put(b, true), after: await put(a, true) });
  const now = Date.now();
  const draft: Draft = {
    v: 1,
    id,
    uid,
    email,
    campaignId,
    pay: form.fields.awaitingPayment === "1",
    admin: form.fields.ownerAdmin === "1" || isAdminEmail(env, email),
    prefill: draftPrefill(form.fields),
    photos,
    pairs: pairFiles,
    video: form.video ? await put(form.video, false) : null,
    createdAt: new Date(now).toISOString(),
    exp: now + DRAFT_TTL_MS,
  };
  await saveDraft(env.PHOTOS, draft);
  return json({ ok: true, draftId: id, expiresAt: new Date(draft.exp).toISOString() }, 201);
}

/**
 * GET /api/internal/drafts/<id>?advaultUserId=  AdVault reads the result back
 * (server side) before trusting the frame's "created" message. 404 unless the
 * draft is this AdVault user's.
 */
async function getDraftInternal(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const draft = await loadDraft(env.PHOTOS, id);
  if (!draft || draft.uid !== url.searchParams.get("advaultUserId")) return json({ ok: false, error: "no_draft" }, 404);
  const r = draft.result;
  return json({
    ok: true,
    campaignId: draft.campaignId,
    awaitingPayment: draft.pay,
    result: r ? { slug: r.slug, siteUrl: r.siteUrl, editUrl: r.editUrl, pending: r.pending } : null,
  });
}

/** The draft the signed-in owner may build from, or why not. */
async function sessionDraft(request: Request, env: Env, id: string): Promise<{ draft: Draft; account: Account } | null> {
  if (!DRAFT_ID.test(id)) return null;
  const account = await currentAccount(env.SITES, request);
  if (!account) return null;
  const draft = await loadDraft(env.PHOTOS, id);
  if (!draft || draft.accountId !== account.id || draftExpired(draft)) return null;
  return { draft, account };
}

/** A site built here goes live at once while billing is off, or for an admin (comped). */
function newSitePublishes(env: Env, account: { email: string } | null): boolean {
  return !billingConfig(env).on || isAdminEmail(env, account?.email);
}

/** The builder in AdVault create mode (embed chrome, pre-filled). */
function embedBuilderMode(env: Env, draft: Draft, account: Account): FormMode {
  return {
    kind: "new",
    account,
    admin: draft.admin,
    // AdVault charges first when `pay`: the site is made unpublished.
    publishesNow: !draft.pay,
    embedDraft: {
      id: draft.id,
      photos: draft.photos.map((p) => ({ key: p.key, url: `${env.PUBLIC_ORIGIN}/embed/draft/${draft.id}/${p.key.split("/").pop()}` })),
      pairs: draft.pairs.map((p) => ({
        before: `${env.PUBLIC_ORIGIN}/embed/draft/${draft.id}/${p.before.key.split("/").pop()}`,
        after: `${env.PUBLIC_ORIGIN}/embed/draft/${draft.id}/${p.after.key.split("/").pop()}`,
      })),
      video: Boolean(draft.video),
    },
  };
}

function draftValues(draft: Draft): Record<string, string> {
  return { ...draft.prefill } as Record<string, string>;
}

/**
 * GET /embed/new?token=  AdVault's create handoff: valid signature, at most
 * 60 s old, never used before, the draft is this user's, for this campaign,
 * with the same pay flag, and the account has no website yet (admins
 * excepted). Then the normal session cookie and a 303 to ?draft=<id>.
 * GET /embed/new?draft=<id>  the builder, for the signed-in account the
 * handoff linked to that draft.
 */
async function embedNew(request: Request, env: Env, url: URL, head: boolean): Promise<Response> {
  const token = url.searchParams.get("token");
  if (token === null) {
    const got = await sessionDraft(request, env, url.searchParams.get("draft") ?? "");
    if (!got) return embedMessage("Please reopen", EMBED_CREATE_EXPIRED, 403);
    if (got.draft.result) return redirectTo(env, `/embed/created?draft=${encodeURIComponent(got.draft.id)}`);
    return builder(env, embedBuilderMode(env, got.draft, got.account), undefined, draftValues(got.draft));
  }
  const fail = () => embedMessage("Please reopen", `This link has expired. ${EMBED_CREATE_EXPIRED}`, 403);
  const checked = await verifyCreateHandoff(env.INTERNAL_TOKEN, token);
  if (!checked.ok) {
    if (checked.error === "not_configured") return embedMessage("Not available", "Building from AdVault isn't switched on yet.", 503);
    console.warn("embed_create_refused", { reason: checked.error });
    return fail();
  }
  const h = checked.handoff;
  if (head) return embedMessage("Opening the website builder", "One moment.", 200);
  const jtiKey = `embedjti:${h.jti}`;
  if (await env.SITES.get(jtiKey)) {
    console.warn("embed_create_refused", { reason: "reused" });
    return fail();
  }
  await env.SITES.put(jtiKey, "1", { expirationTtl: HANDOFF_JTI_TTL_SECONDS });
  const draft = await loadDraft(env.PHOTOS, h.draft);
  if (!draft || draft.uid !== h.uid || draft.campaignId !== h.campaignId || draft.pay !== h.pay || draftExpired(draft)) {
    console.warn("embed_create_refused", { reason: "bad_draft" });
    return fail();
  }
  const account = await accountForAdvault(env.SITES, { advaultUserId: h.uid, email: h.email });
  if (draft.accountId && draft.accountId !== account.id) {
    console.warn("embed_create_refused", { reason: "other_account" });
    return fail();
  }
  if (!draft.result && !draft.admin && (await accountSites(env, account)).length > 0) {
    return embedMessage("You already have a website", "Your account already has a website (one per account). Go back to AdVault and use it for this campaign.", 409);
  }
  if (!draft.accountId) await saveDraft(env.PHOTOS, { ...draft, accountId: account.id });
  const res = redirectTo(env, `/embed/new?draft=${encodeURIComponent(draft.id)}`, sessionCookie(await startSession(env.SITES, account.id)));
  res.headers.set("referrer-policy", "no-referrer");
  res.headers.set("cache-control", "no-store");
  return res;
}

/** GET /embed/draft/<id>/<file>  a draft photo, for the account building from it only. */
async function embedDraftFile(request: Request, env: Env, id: string, file: string): Promise<Response> {
  const got = await sessionDraft(request, env, id);
  const key = `drafts/${id}/${file}`;
  if (!got || !draftFileKeys(got.draft).includes(key)) return new Response("Not found", { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

async function draftAsFile(env: Env, f: DraftFile): Promise<File | null> {
  const obj = await env.PHOTOS.get(f.key);
  if (!obj || !("arrayBuffer" in obj)) return null;
  return new File([await (obj as R2ObjectBody).arrayBuffer()], f.key.split("/").pop() ?? "file", { type: f.type });
}

/**
 * POST /api/embed/sites  create from the embedded builder. The session and
 * the draft say who and for which campaign (never the form); the form is the
 * full builder, validated exactly like the public one (facts only, no links,
 * address, attest tick, uploads), then made by the SAME createForAdvault as
 * internal create: source advault, owner linked, pending when AdVault charges,
 * one website per account, one per phone. The draft's photos, pairs and video
 * go through that path as files, so they are stored like internal create's.
 */
async function embedCreate(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const id = form?.fields.draft ?? "";
  const got = sameOrigin(request, env.PUBLIC_ORIGIN) ? await sessionDraft(request, env, id) : null;
  if (!form || !got) {
    return wantsJson(request)
      ? json({ ok: false, errors: { form: `This page has expired. ${EMBED_CREATE_EXPIRED}` } }, 403)
      : embedMessage("Please reopen", EMBED_CREATE_EXPIRED, 403);
  }
  const { draft, account } = got;
  if (draft.result) {
    const done = `/embed/created?draft=${encodeURIComponent(draft.id)}`;
    return wantsJson(request) ? json({ ok: true, next: `${env.PUBLIC_ORIGIN}${done}` }) : redirectTo(env, done);
  }
  const mode = embedBuilderMode(env, draft, account);
  const { fields, files } = form;
  const parsed = parseContent(fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  if (fields.attest !== "yes") errors.attest = "Please confirm this.";
  // The draft's photos the owner kept, in the order they arranged them.
  const keptPhotos = [...new Set(form.keepDraft)].map((k) => draft.photos.find((p) => p.key === k)).filter((p): p is DraftFile => Boolean(p));
  const photoErr = checkPhotos(files, keptPhotos.length);
  if (photoErr) errors.photos = photoErr;
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) {
    errors.video = `Use one MP4 video, up to ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`;
  }
  const listingPick = builderExtrasChecks(form, parsed, errors);
  const keptPairs = [...new Set(form.keepDraftPair)].map((i) => draft.pairs[Number(i)]).filter((p): p is Draft["pairs"][number] => Boolean(p));
  // A pair only fits a trade (the ONE allowlist); AdVault already filtered, this
  // covers the owner changing the business type here.
  if (keptPairs.length && parsed.ok && !beforeAfterAllowed(parsed.value.category)) errors.beforeAfter = "Before & after photos can't be shown for this type of business. Untick them.";
  const { acct_password: _pw, ...safeFields } = fields;
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, safeFields);

  const draftFiles = (await Promise.all(keptPhotos.map((p) => draftAsFile(env, p)))).filter((f): f is File => Boolean(f));
  const pairFiles: [File, File][] = [];
  for (const p of keptPairs) {
    const [b, a] = await Promise.all([draftAsFile(env, p.before), draftAsFile(env, p.after)]);
    if (b && a) pairFiles.push([b, a]);
  }
  const video = form.video ?? (draft.video && fields.keepDraftVideo === "yes" ? await draftAsFile(env, draft.video) : null);
  const result = await createForAdvault(
    env,
    {
      content: parsed.value,
      requested: fields.slug ? normaliseAddress(fields.slug) : null,
      advId: draft.uid,
      advEmail: draft.email,
      adminTest: draft.admin,
      awaiting: draft.pay,
      files: [...draftFiles, ...files],
      video,
      pairs: pairFiles,
      menu: form.menu,
      schedule: form.schedule,
      listings: listingPick.ok ? listingPick.items : [],
    },
    errors,
  );
  if (!result.ok && "conflict" in result) {
    return rejected(request, env, mode, { form: "Your account already has a website (one per account). Go back to AdVault and use it for this campaign." }, safeFields, 409);
  }
  if (!result.ok) return rejected(request, env, mode, result.errors, safeFields);
  const { made } = result;
  // Re-read before saving: one site per draft, even if two submits raced.
  const latest = (await loadDraft(env.PHOTOS, draft.id)) ?? draft;
  await saveDraft(env.PHOTOS, { ...latest, result: latest.result ?? { slug: made.slug, siteUrl: made.siteUrl, editUrl: made.editUrl, pending: made.pending } });
  // The media now live under sites/<slug>/; the draft's copies go.
  await deletePhotos(env, draftFileKeys(draft));
  console.log("embed_site_created", { slug: made.slug, pending: made.pending });
  const next = `/embed/created?draft=${encodeURIComponent(draft.id)}`;
  return wantsJson(request) ? json({ ok: true, next: `${env.PUBLIC_ORIGIN}${next}` }) : redirectTo(env, next);
}

/** GET /embed/created?draft=<id>  "Created", and the message to AdVault. */
async function embedCreated(request: Request, env: Env, url: URL): Promise<Response> {
  const got = await sessionDraft(request, env, url.searchParams.get("draft") ?? "");
  const r = got?.draft.result;
  if (!got || !r) return embedMessage("Please reopen", EMBED_CREATE_EXPIRED, 403);
  const n = nonce();
  const res = allowEmbedFraming(html(embedCreatedPage({ slug: r.slug, siteUrl: r.siteUrl, pending: r.pending, draft: got.draft.id, nonce: n }), 200, n));
  res.headers.set("cache-control", "no-store");
  return res;
}

/** The edit form plus its "Plan & billing" (BILLING on) and "Visitors" (STATS bound) sections. */
async function editMode(env: Env, site: Site, key: string, justPaid = false, embed = false): Promise<FormMode & { kind: "edit" }> {
  const cfg = billingConfig(env);
  const now = new Date();
  let billing: BillingView | undefined;
  // Embedded in AdVault: no plan, credits or pay buttons (AdVault covers it).
  if (cfg.on && !embed) {
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
  const visitors = await visitorsFor(env, site, cfg, now);
  const owner = site.ownerId ? await loadAccount(env.SITES, site.ownerId) : null;
  return {
    kind: "edit",
    site,
    key,
    photoUrl: (k) => `${env.PUBLIC_ORIGIN}/p/${k}`,
    billing,
    visitors,
    pendingReviews: await listPendingReviews(env, site.slug),
    siteUrl: siteUrl(env, site.slug),
    admin: isAdminEmail(env, owner?.email),
    ...(embed ? { embed: true } : {}),
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
    PRO_FESTIVE: env.STRIPE_PRICE_PRO_FESTIVE || undefined,
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
  const site = /^[a-z0-9-]+$/.test(slug) ? await authorize(env, slug, key, request) : null;
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
  const site = /^[a-z0-9-]+$/.test(slug) ? await authorize(env, slug, key, request) : null;
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

/**
 * Edit access: the secret edit key, or (accounts) a signed-in owner. A POST
 * acting on the session alone must come from our own pages (Origin check).
 */
async function authorize(env: Env, slug: string, key: string, request?: Request): Promise<Site | null> {
  const site = await loadSite(env, slug);
  if (!site || site.status !== "live") return null;
  if (key && safeEqual(await sha256Hex(key), site.editKeyHash)) return site;
  if (!request || !site.ownerId) return null;
  if (request.method !== "GET" && !sameOrigin(request, env.PUBLIC_ORIGIN)) return null;
  const account = await currentAccount(env.SITES, request);
  return account && account.id === site.ownerId ? site : null;
}

// ---------------------------------------------------------------------------
// Accounts (accounts.ts)

const LOGIN_LIMIT = 10;

/** 10 sign-in or sign-up tries per connection per 15 minutes. */
async function authRateLimited(request: Request, env: Env): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `rl:auth:${await sha256Hex(`${ip}:${Math.floor(Date.now() / 900_000)}`)}`;
  const n = Number((await env.SITES.get(key)) ?? "0");
  if (n >= LOGIN_LIMIT) return true;
  await env.SITES.put(key, String(n + 1), { expirationTtl: 1800 });
  return false;
}

// POST /api/help { q } or { id }: the panda helper's answer, from help.ts.
// Public, reads and stores nothing.
async function helpAnswer(request: Request, env: Env): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? "0") > 4096) return json({ error: "too_long" }, 413);
  let body: { q?: unknown; id?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const topics = helpTopics(billingConfig(env), new Date());
  const found =
    typeof body.id === "string" ? topics.filter((t) => t.id === body.id) : typeof body.q === "string" ? matchTopics(body.q.slice(0, 300), topics) : [];
  const [t, ...more] = found;
  return json({
    topic: t ? { id: t.id, q: t.q, a: t.a, links: t.links ?? [] } : null,
    more: more.map(({ id, q }) => ({ id, q })),
  });
}

const CONTACT_LIMIT = 5;

// POST /contact: the form is emailed to us by AdVault's API (it holds the
// mailer token) with Reply-To = the sender. Nothing is stored here but a
// short-lived per-connection counter.
async function contactSubmit(request: Request, env: Env): Promise<Response> {
  const account = await currentAccount(env.SITES, request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html(contactPage({ error: "Please use the form on this page." }), 400);
  }
  const field = (name: string, max: number) => {
    const v = form.get(name);
    return (typeof v === "string" ? v : "").trim().slice(0, max);
  };
  const values = { name: field("name", 120), email: field("email", 254), subject: field("subject", 150), message: field("message", 4000) };
  const again = (error: string, status: number) => html(contactPage({ signedIn: account !== null, values, error }), status);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return again("Please use the form on this page.", 403);
  if (field("website", 500)) return html(contactPage({ signedIn: account !== null, sentTo: values.email })); // honeypot
  if (!values.name || !values.subject || !values.message || emailProblem(normaliseEmail(values.email))) {
    return again("Please fill in your name, a valid email, a subject and your message.", 400);
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `rl:contact:${await sha256Hex(`${ip}:${Math.floor(Date.now() / 3_600_000)}`)}`;
  const n = Number((await env.SITES.get(key)) ?? "0");
  if (n >= CONTACT_LIMIT) return again("Too many messages right now. Please try again in an hour, or email us.", 429);
  await env.SITES.put(key, String(n + 1), { expirationTtl: 7200 });
  const sent = await sendContact(advaultApi(env), { ...values, ...(account?.advaultUserId ? { userId: account.advaultUserId } : {}) });
  if (!sent) return again("We couldn't send your message. Please email us instead.", 503);
  return html(contactPage({ signedIn: account !== null, sentTo: values.email }));
}

function withSession(res: Response, token: string): Response {
  const out = new Response(res.body, res);
  out.headers.append("set-cookie", sessionCookie(token));
  return out;
}

function redirectTo(env: Env, path: string, cookie?: string): Response {
  const res = new Response(null, { status: 303, headers: { location: `${env.PUBLIC_ORIGIN}${path}` } });
  if (cookie) res.headers.append("set-cookie", cookie);
  return res;
}

/** AdVault's internal API, where the shared 3PandaLabs account lives. */
function advaultApi(env: Env) {
  return { apiUrl: env.ADVAULT_API_URL, token: env.INTERNAL_TOKEN };
}

/** When this account's first website was made (its owned, live sites), or undefined. */
async function firstSiteAt(env: Env, account: Account): Promise<string | undefined> {
  let first: string | undefined;
  for (const slug of account.sites) {
    const site = await ownedSite(env, account, slug);
    if (!site) continue;
    if (!first || site.createdAt < first) first = site.createdAt;
  }
  return first;
}

/**
 * Shared account: tell AdVault this account uses SiteVault (has a website).
 * In the background; a failure is retried by the owner's next sign-in.
 */
function reportSitevaultUse(env: Env, ctx: ExecutionContext, account: Account, at?: string): void {
  if (!account.advaultUserId) return;
  ctx.waitUntil(markSitevaultUsed(advaultApi(env), account.advaultUserId, at).then(() => undefined));
}

async function authSubmit(request: Request, env: Env, ctx: ExecutionContext, kind: "login" | "signup"): Promise<Response> {
  const form = await readForm(request);
  const email = normaliseEmail(form?.fields.email ?? "");
  const password = form?.fields.password ?? "";
  const nextRaw = form?.fields.next ?? "/account";
  const next = /^\/[a-z0-9/_?=&-]*$/i.test(nextRaw) ? nextRaw : "/account";
  const again = (error: string, status = 400) => html(authPage(kind, { error, email, next }), status);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return again("Please use the form on this page.", 403);
  if (await authRateLimited(request, env)) return again("Too many tries. Wait 15 minutes and try again.", 429);
  if (kind === "login") {
    const account = email ? await accountByEmail(env.SITES, email) : null;
    if (account && (await verifyPassword(password, account.pw))) {
      // Shared 3PandaLabs account: an older SiteVault-only account moves to it
      // now, with the password just proven (best effort; retried next time).
      // A linked one with a website re-reports its use (self-healing).
      const siteAt = account.sites.length > 0 ? await firstSiteAt(env, account) : undefined;
      if (!account.advaultUserId) await moveToSharedAccount(env.SITES, advaultApi(env), account, password, siteAt);
      else if (siteAt) reportSitevaultUse(env, ctx, account, siteAt);
      return redirectTo(env, next, sessionCookie(await startSession(env.SITES, account.id)));
    }
    // Same login as AdVault: an AdVault customer's email + password works here too.
    const adv = await verifyAdvaultLogin(env.ADVAULT_API_URL, env.INTERNAL_TOKEN, email, password);
    if (adv) {
      const linked = await accountForAdvault(env.SITES, adv);
      if (linked.sites.length > 0) reportSitevaultUse(env, ctx, linked, await firstSiteAt(env, linked));
      return redirectTo(env, next, sessionCookie(await startSession(env.SITES, linked.id)));
    }
    return again("Wrong email or password.", 401);
  }
  const problem = emailProblem(email) ?? passwordProblem(password);
  if (problem) return again(problem);
  const made = await signUpShared(env.SITES, advaultApi(env), email, password);
  if (made === "exists") return again("This email already has a 3PandaLabs account (SiteVault or AdVault). Sign in instead.", 409);
  console.log("account_created", { id: made.id });
  return redirectTo(env, next, sessionCookie(await startSession(env.SITES, made.id)));
}

async function logout(request: Request, env: Env): Promise<Response> {
  const token = sessionToken(request.headers.get("cookie"));
  if (token && sameOrigin(request, env.PUBLIC_ORIGIN)) await endSession(env.SITES, token);
  return redirectTo(env, "/", clearCookie);
}

// Forgot password: AdVault emails the reset link (the shared login lives there).
// Always the same confirmation, so this never reveals whether an email has an
// account — nor whether AdVault was reachable.
async function forgotPasswordSubmit(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const email = normaliseEmail(form?.fields.email ?? "");
  if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return html(forgotPasswordPage({ error: "Please use the form on this page.", email }), 403);
  if (await authRateLimited(request, env)) return html(forgotPasswordPage({ error: "Too many tries. Wait 15 minutes and try again.", email }), 429);
  if (email) await requestPasswordReset(advaultApi(env), email, `${env.PUBLIC_ORIGIN}/reset-password`);
  return html(forgotPasswordPage({ sent: true }));
}

// Reset password: the token from the email link plus a new password, proxied to
// AdVault which validates the token once and sets the password.
async function resetPasswordSubmit(request: Request, env: Env): Promise<Response> {
  const form = await readForm(request);
  const token = form?.fields.token ?? "";
  const password = form?.fields.password ?? "";
  const back = (error: string, status = 400) => html(resetPasswordPage({ token, error }), status);
  if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return back("Please use the form on this page.", 403);
  if (await authRateLimited(request, env)) return back("Too many tries. Wait 15 minutes and try again.", 429);
  if (!token) return html(resetPasswordPage({}), 400);
  const problem = passwordProblem(password);
  if (problem) return back(problem);
  if (!(await confirmPasswordReset(advaultApi(env), token, password))) {
    return back("That reset link is invalid or has expired. Request a new one.", 400);
  }
  return redirectTo(env, "/login?reset=1");
}

// Change password for a signed-in owner: AdVault verifies the current one and
// sets the new one. Result is carried back to /account via a ?pw= code.
async function changePasswordSubmit(request: Request, env: Env): Promise<Response> {
  const account = await currentAccount(env.SITES, request);
  if (!account || !sameOrigin(request, env.PUBLIC_ORIGIN)) return redirectTo(env, "/login");
  const form = await readForm(request);
  const currentPassword = form?.fields.currentPassword ?? "";
  const newPassword = form?.fields.newPassword ?? "";
  if (passwordProblem(newPassword)) return redirectTo(env, "/account?pw=weak");
  const r = await changePassword(advaultApi(env), account.email, currentPassword, newPassword);
  return redirectTo(env, `/account?pw=${r === "ok" ? "1" : r}`);
}

/**
 * One of an account's sites by the slug it was added under. A rename doesn't
 * update `account.sites`, so an old slug is followed through its alias.
 */
async function ownedSite(env: Env, account: Account, slug: string): Promise<Site | null> {
  const site = (await loadSite(env, slug)) ?? (await aliasTarget(env, slug).then((t) => (t ? loadSite(env, t) : null)));
  return site && site.status === "live" && site.ownerId === account.id ? site : null;
}

/** `withStats`: also each site's visitor stats (the owner's My website page). */
async function accountSites(env: Env, account: Account, withStats = false): Promise<AccountSite[]> {
  const cfg = billingConfig(env);
  const now = new Date();
  const out: AccountSite[] = [];
  const seen = new Set<string>();
  for (const slug of account.sites) {
    const site = await ownedSite(env, account, slug);
    if (!site || seen.has(site.slug)) continue;
    seen.add(site.slug);
    out.push({
      slug: site.slug,
      name: site.businessName,
      siteUrl: siteUrl(env, site.slug),
      state: siteState(site, cfg, now),
      pendingReviews: (await listPendingReviews(env, site.slug)).length,
      ...(withStats ? { visitors: await visitorsFor(env, site, cfg, now) } : {}),
    });
  }
  return out;
}

// GET /api/internal/account-site?advaultUserId=&email=  (INTERNAL_TOKEN)
// The website owned by the shared 3PandaLabs account (AdVault user id, else
// the same email, as accountForAdvault links them; read-only, links nothing).
// AdVault calls it so a campaign can use a site built here instead of making
// a second one. Renames are followed. 404 no_site when there is none.
async function accountSiteInternal(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = bearer(request, env.INTERNAL_TOKEN);
  if (auth !== "ok") return json({ ok: false, error: auth === "off" ? "internal_disabled" : "unauthorized" }, auth === "off" ? 503 : 401);
  const advaultUserId = url.searchParams.get("advaultUserId") ?? "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(advaultUserId)) return json({ ok: false, error: "invalid" }, 400);
  const account = await findAccountForAdvault(env.SITES, { advaultUserId, email: url.searchParams.get("email") });
  const sites = account ? await accountSites(env, account) : [];
  // Several only for admins (exempt from one per account): prefer a live one.
  const site = sites.find((s) => s.state === "live" || s.state === "grace") ?? sites[0];
  if (!site) return json({ ok: false, error: "no_site" }, 404);
  const full = await loadSite(env, site.slug);
  return json({ ok: true, slug: site.slug, siteUrl: site.siteUrl, state: site.state, source: full?.source ?? null, count: sites.length });
}

// Admin-only dashboard: every live site, with status totals and per-category stats.
// Gated on the signed-in account's email (ADMIN_EMAILS), not ADMIN_TOKEN.
async function adminDashboard(request: Request, env: Env): Promise<Response> {
  const account = await currentAccount(env.SITES, request);
  if (!account) return Response.redirect(`${env.PUBLIC_ORIGIN}/login?next=/admin`, 302);
  if (!isAdminEmail(env, account.email)) return html(messagePage("Not found", "This page doesn't exist.", "Not found"), 404);
  const cfg = billingConfig(env);
  const now = new Date();
  const sites: AdminSite[] = [];
  for (const k of await listSites(env)) {
    if ((k.metadata as { status?: string } | undefined)?.status === "removed") continue;
    const slug = k.name.slice("site:".length);
    const site = await loadSite(env, slug);
    if (!site || site.status !== "live") continue;
    sites.push({ slug, name: site.businessName, category: site.category, source: site.source, state: siteState(site, cfg, now), siteUrl: siteUrl(env, slug) });
  }
  const n = nonce();
  return html(adminPage(sites, n), 200, n);
}

/**
 * The owner's visitor stats for a site (edit page and My website): the full
 * breakdown on Pro (or billing off), the 30-day count on Basic. undefined
 * without the D1 binding or on a read error. Never shown on the customer site.
 */
async function visitorsFor(env: Env, site: Site, cfg: ReturnType<typeof billingConfig>, now: Date): Promise<VisitorsView | undefined> {
  if (!env.STATS) return undefined;
  try {
    const stats = await readStats(env.STATS, [site.slug, ...(site.aliases ?? [])], now);
    return stats ? { stats, full: statsVisible(site, cfg, now) } : undefined;
  } catch (err) {
    console.warn("stats read failed", String(err));
    return undefined;
  }
}

async function accountHome(request: Request, env: Env, url: URL, claimError?: string): Promise<Response> {
  const account = await currentAccount(env.SITES, request);
  if (!account) return Response.redirect(`${env.PUBLIC_ORIGIN}/login`, 302);
  const pw = url.searchParams.get("pw");
  const pwError =
    pw === "wrong"
      ? "Your current password is incorrect."
      : pw === "weak"
        ? "Your new password needs 10–200 characters."
        : pw === "error"
          ? "Couldn't update your password right now. Please try again."
          : undefined;
  return html(
    // Admins (many sites) see the list as before; an owner sees their site's visitors.
    accountPage(isIdOnlyAccount(account) ? "an AdVault test customer" : account.email, await accountSites(env, account, !isAdminEmail(env, account.email)), {
      claimError,
      claimed: url.searchParams.get("claimed") === "1",
      admin: isAdminEmail(env, account.email),
      pwChanged: pw === "1",
      pwError,
    }),
    claimError || pwError ? 400 : 200,
  );
}

// Add a site made before accounts: prove ownership with its edit link.
async function claimSite(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const account = await currentAccount(env.SITES, request);
  if (!account || !sameOrigin(request, env.PUBLIC_ORIGIN)) return redirectTo(env, "/login");
  const form = await readForm(request);
  const fail = (msg: string) => accountHome(request, env, new URL(`${env.PUBLIC_ORIGIN}/account`), msg);
  let slug = "";
  let key = "";
  try {
    const link = new URL(form?.fields.editLink ?? "");
    const m = link.pathname.match(/^\/edit\/([a-z0-9-]+)$/);
    slug = m ? m[1]! : "";
    key = link.searchParams.get("k") ?? "";
  } catch {
    return fail("That isn't a SiteVault edit link.");
  }
  const current = slug ? ((await env.SITES.get(siteKey(slug))) ? slug : await aliasTarget(env, slug)) : null;
  const site = current && key ? await authorize(env, current, key) : null;
  if (!site) return fail("That edit link didn't work. Check you copied all of it.");
  if (site.ownerId && site.ownerId !== account.id) return fail("This website already belongs to another account. Email sitevault@3pandalabs.com if that's wrong.");
  if (!isAdminEmail(env, account.email) && (await accountSites(env, account)).some((x) => x.slug !== site.slug))
    return fail("Your account already has a website (one per account). Sign out and create a new account for this one.");
  await saveSite(env, { ...site, ownerId: account.id, updatedAt: new Date().toISOString() });
  await addSiteToAccount(env.SITES, account, site.slug);
  reportSitevaultUse(env, ctx, account);
  console.log("site_claimed", { slug: site.slug, account: account.id });
  return redirectTo(env, "/account?claimed=1");
}

// Photos and the ad video. Byte ranges are supported because iPhone Safari
// will not play a <video> whose server ignores Range.
async function photo(env: Env, key: string, request: Request): Promise<Response> {
  if (!/^sites\/[a-z0-9-]+\/[A-Za-z0-9_-]+\.(jpg|png|webp|mp4|pdf)$/.test(key)) return new Response("Not found", { status: 404 });
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

type Parsed = {
  fields: Record<string, string>;
  files: File[];
  keep: string[];
  video: File | null;
  /** Before & after upload slots (ba1Before ... ba2After), non-empty files only. */
  ba: Partial<Record<BeforeAfterField, File>>;
  /** Existing before & after pairs to keep, by their "before" key (edit page). */
  keepPair: string[];
  /** New menu files (name="menu"), non-empty only. */
  menu: File[];
  /** Existing menu files to keep, by R2 key (edit page). */
  keepMenu: string[];
  /** New class-schedule file (name="schedule"), if any. */
  schedule: File | null;
  /** New listing photo slots (listing1Photo … listingNPhoto), non-empty only. */
  listingPhotos: Partial<Record<string, File>>;
  /** AdVault create mode: draft photos to keep, by draft key, in the page's order. */
  keepDraft: string[];
  /** AdVault create mode: draft before & after pairs to keep, by index. */
  keepDraftPair: string[];
  /** Existing listings to keep, by their photo key (edit page). */
  keepListing: string[];
};

const LISTING_PHOTO_SET = new Set<string>(LISTING_PHOTO_FIELDS);

const BA_FIELD_NAMES: readonly string[] = BEFORE_AFTER_FIELDS.flat();

async function readForm(request: Request): Promise<Parsed | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data") && !type.includes("application/x-www-form-urlencoded")) return null;
  const form = await request.formData();
  const fields: Record<string, string> = {};
  const files: File[] = [];
  const keep: string[] = [];
  const keepPair: string[] = [];
  const keepMenu: string[] = [];
  const ba: Partial<Record<BeforeAfterField, File>> = {};
  const menu: File[] = [];
  const listingPhotos: Partial<Record<string, File>> = {};
  const keepListing: string[] = [];
  const keepDraft: string[] = [];
  const keepDraftPair: string[] = [];
  let video: File | null = null;
  let schedule: File | null = null;
  for (const [k, v] of form as unknown as Iterable<[string, string | File]>) {
    if (typeof v === "string") {
      if (k === "keep") keep.push(v);
      else if (k === "keepPair") keepPair.push(v);
      else if (k === "keepMenu") keepMenu.push(v);
      else if (k === "keepListing") keepListing.push(v);
      else if (k === "keepDraft") keepDraft.push(v);
      else if (k === "keepDraftPair") keepDraftPair.push(v);
      else fields[k] = v;
    } else if (k === "photos" && v.size > 0) {
      files.push(v);
    } else if (k === "video" && v.size > 0) {
      video = v;
    } else if (k === "menu" && v.size > 0) {
      menu.push(v);
    } else if (k === "schedule" && v.size > 0) {
      schedule = v;
    } else if (LISTING_PHOTO_SET.has(k) && v.size > 0) {
      listingPhotos[k] = v;
    } else if (BA_FIELD_NAMES.includes(k) && v.size > 0) {
      ba[k as BeforeAfterField] = v;
    }
  }
  return { fields, files, keep, video, ba, keepPair, menu, keepMenu, schedule, listingPhotos, keepListing, keepDraft, keepDraftPair };
}

function checkPhotos(files: File[], existing: number, maxBytes = MAX_PHOTO_BYTES): string | null {
  if (existing + files.length > MAX_PHOTOS) return `Up to ${MAX_PHOTOS} photos in total.`;
  for (const f of files) {
    if (!PHOTO_TYPES.includes(f.type)) return "That file isn't a photo we can use. Add a JPG, PNG, WebP or HEIC image.";
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

const nameTownKey = (name: string, city: string) => `nt:${slugify(name)}|${slugify(city.split(",")[0] ?? "")}`;

async function indexSite(env: Env, site: Site): Promise<void> {
  await env.SITES.put(nameTownKey(site.businessName, site.city), site.slug);
}

async function unindexSite(env: Env, site: Pick<Site, "slug" | "businessName" | "city">): Promise<void> {
  for (const k of [nameTownKey(site.businessName, site.city)]) {
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

/** Owner emails that publish free (3PandaLabs admins), from ADMIN_EMAILS. */
function isAdminEmail(env: Env, email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(e);
}

async function insertSite(
  env: Env,
  content: SiteContent,
  files: File[],
  source: Site["source"],
  videoFile: File | null,
  /** Already reserved by the caller (reserveNewAddress). */
  slug: string,
  awaitingPayment = false,
  ownerId: string | null = null,
  comp = false,
  adminTest = false,
  pairFiles: [File, File][] = [],
  menuFiles: File[] = [],
  scheduleFile: File | null = null,
  listingItems: { photo: File; price: string; details: string; status: Listing["status"] }[] = [],
) {
  const key = randomKey();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const cfg = billingConfig(env);
  // BILLING off: no billing record, so the site counts as early access later.
  // Admin-owned sites are comped: published free (only meaningful while BILLING is on).
  const billing = comp && cfg.on ? compBilling() : initialBilling(source, cfg, nowDate, awaitingPayment);
  const storeMedia = async () => ({
    photos: await storePhotos(env, slug, files),
    video: await storeVideo(env, slug, videoFile),
    ...(pairFiles.length ? { beforeAfter: await storePairs(env, slug, pairFiles) } : {}),
    ...(menuFiles.length ? { menu: await storeMenu(env, slug, menuFiles) } : {}),
    ...(scheduleFile ? { schedule: (await storeMenu(env, slug, [scheduleFile]))[0] } : {}),
    ...(listingItems.length ? { listings: await storeListings(env, slug, listingItems) } : {}),
  });
  // Nothing made yet: an upload that fails frees the address for the retry.
  const media = await storeMedia().catch(async (err: unknown) => {
    await releaseAddress(env, slug);
    throw err;
  });
  const site: Site = {
    ...(billing ? { billing } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(adminTest ? { adminTest: true } : {}),
    ...content,
    slug,
    ...media,
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

type ListingItem = { photo: File; price: string; details: string; status: Listing["status"] };

/**
 * The ONE AdVault create path, shared by internal create and AdVault create
 * mode (the embedded builder): address check, one website per account (409
 * account_has_site, checked before the phone so the reply names the real
 * reason; AdVault offers "Use my website" on it), one live site per phone,
 * the owner linked to the AdVault user's account, `source = "advault"`,
 * pending when AdVault charges first. AdVault admins (ownerAdmin=1, or an
 * ADMIN_EMAILS owner) make test sites: any number, phone reuse allowed.
 * `errors` holds the caller's own field checks; any error = nothing made.
 */
async function createForAdvault(
  env: Env,
  input: {
    content: SiteContent | null;
    requested: string | null;
    advId: string;
    advEmail: string;
    adminTest: boolean;
    awaiting: boolean;
    files: File[];
    video: File | null;
    pairs: [File, File][];
    menu?: File[];
    schedule?: File | null;
    listings?: ListingItem[];
  },
  errors: FieldErrors,
): Promise<
  | { ok: true; made: Awaited<ReturnType<typeof insertSite>> }
  | { ok: false; conflict: { slug: string; siteUrl: string } }
  | { ok: false; errors: FieldErrors }
> {
  const { content, requested, advId, advEmail, adminTest } = input;
  if (requested) {
    const problem = await requestedAddressProblem(env, requested);
    if (problem) errors.slug = problem;
  }
  if (!adminTest && /^[A-Za-z0-9-]{8,64}$/.test(advId)) {
    const existing = await findAccountForAdvault(env.SITES, { advaultUserId: advId, email: advEmail });
    const has = existing ? (await accountSites(env, existing))[0] : undefined;
    if (has) return { ok: false, conflict: { slug: has.slug, siteUrl: has.siteUrl } };
  }
  if (!content || Object.keys(errors).length > 0) return { ok: false, errors };
  // Before the account is touched, so losing the address changes nothing.
  const slug = await reserveNewAddress(env, content, requested);
  if (!slug) return { ok: false, errors: { slug: ADDRESS_TAKEN } };
  // Same login: the site goes to the AdVault user's SiteVault account (a test
  // customer with no real email: its id-only account, never an email match).
  let owner: Account | null;
  try {
    owner = /^[A-Za-z0-9-]{8,64}$/.test(advId) ? await accountForAdvault(env.SITES, { advaultUserId: advId, email: advEmail }) : null;
  } catch (err) {
    await releaseAddress(env, slug);
    throw err;
  }
  const made = await insertSite(
    env,
    content,
    input.files,
    "advault",
    input.video,
    slug,
    input.awaiting,
    owner?.id ?? null,
    false,
    adminTest,
    input.pairs,
    input.menu ?? [],
    input.schedule ?? null,
    input.listings ?? [],
  );
  if (owner) await addSiteToAccount(env.SITES, owner, made.slug);
  return { ok: true, made };
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
  const photoErr = checkPhotos(form.files, 0, INTERNAL_PHOTO_BYTES);
  if (photoErr) errors.photos = photoErr;
  // Optional before & after pairs (AdVault sends only complete pairs, only for
  // trades where they fit, with the owner's "real photos of our own work").
  const pairs = pickBeforeAfter(form.ba, { existing: 0, types: INTERNAL_BEFORE_AFTER_TYPES, maxBytes: INTERNAL_PHOTO_BYTES });
  if (!pairs.ok) errors.beforeAfter = pairs.error;
  // Only the internal path takes a video (AdVault's finished ad); the public
  // form doesn't, so a stranger can't host arbitrary video on our domain.
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) {
    errors.video = "Video must be an MP4 under 40 MB.";
  }
  const result = await createForAdvault(
    env,
    {
      content: parsed.ok ? parsed.value : null,
      requested: form.fields.slug ? normaliseAddress(form.fields.slug) : null,
      advId: form.fields.ownerAdvaultUserId ?? "",
      advEmail: normaliseEmail(form.fields.ownerEmail ?? ""),
      adminTest: form.fields.ownerAdmin === "1" || isAdminEmail(env, form.fields.ownerEmail),
      // "1": AdVault charges $10 first; the site waits unpublished until /paid.
      awaiting: form.fields.awaitingPayment === "1",
      files: form.files,
      video: form.video,
      pairs: pairs.ok ? pairs.pairs : [],
    },
    errors,
  );
  if (!result.ok && "conflict" in result) return json({ ok: false, error: "account_has_site", ...result.conflict }, 409);
  if (!result.ok) return json({ ok: false, error: "invalid", errors: result.errors }, 400);
  return json({ ok: true, slug: result.made.slug, siteUrl: result.made.siteUrl, editUrl: result.made.editUrl }, 201);
}

/** AdVault's own polished ad photos can be larger than a phone-shrunk upload. */
const INTERNAL_PHOTO_BYTES = 8 * 1024 * 1024;

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

/** Store before & after pairs: web-sized like photos, same key scheme. */
async function storePairs(env: Env, slug: string, pairs: [File, File][]): Promise<BeforeAfter[]> {
  const out: BeforeAfter[] = [];
  for (const [b, a] of pairs) {
    const [before, after] = await storePhotos(env, slug, [b, a]);
    out.push({ before: before!, after: after! });
  }
  return out;
}

const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

async function storeVideo(env: Env, slug: string, file: File | null): Promise<string | null> {
  if (!file) return null;
  const key = `sites/${slug}/${randomKey(9)}.mp4`;
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "video/mp4" } });
  return key;
}

// Menu files are stored AS-IS (no resize): a menu must stay legible, and a PDF
// can't go through the image pipeline anyway. The per-file size cap keeps them
// reasonable. Extension drives the content-type on serve and inline-vs-link.
async function storeMenu(env: Env, slug: string, files: File[]): Promise<string[]> {
  const keys: string[] = [];
  for (const f of files) {
    const ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
    const key = `sites/${slug}/${randomKey(9)}.${ext}`;
    await env.PHOTOS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
    keys.push(key);
  }
  return keys;
}

/** Read the per-slot listing fields (photo + text) out of a parsed form. */
function listingSlots(form: Parsed): { photo: File | undefined; price: string; details: string; status: string }[] {
  return LISTING_SLOTS.map((s) => ({
    photo: form.listingPhotos[s.photo],
    price: (form.fields[s.price] ?? "").trim(),
    details: (form.fields[s.details] ?? "").trim(),
    status: form.fields[s.status] ?? "",
  }));
}

/** Store listing photos (web-sized like photos) and assemble the Listing records. */
async function storeListings(env: Env, slug: string, items: { photo: File; price: string; details: string; status: Listing["status"] }[]): Promise<Listing[]> {
  const out: Listing[] = [];
  for (const it of items) {
    const [photo] = await storePhotos(env, slug, [it.photo]);
    out.push({ photo: photo!, price: it.price, details: it.details, status: it.status });
  }
  return out;
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

/**
 * The builder's category-gated uploads (menu, class schedule, listings), as
 * checked on create. Shared by the public builder and AdVault create mode.
 */
function builderExtrasChecks(form: Parsed, parsed: ReturnType<typeof parseContent>, errors: FieldErrors) {
  // Menu files (restaurants/bakeries can add one while building).
  if (form.menu.length && parsed.ok && !menuAllowed(parsed.value.category)) errors.menu = "A menu can't be added for this type of business.";
  else {
    const menuProblem = checkMenu(form.menu, 0);
    if (menuProblem) errors.menu = menuProblem;
  }
  // Class schedule (fitness businesses can add one while building).
  if (form.schedule && parsed.ok && !scheduleAllowed(parsed.value.category)) errors.schedule = "A schedule can't be added for this type of business.";
  else {
    const schedProblem = checkScheduleFile(form.schedule);
    if (schedProblem) errors.schedule = schedProblem;
  }
  // Featured listings (real estate).
  const listingPick = pickListings(listingSlots(form), { existing: 0, types: PHOTO_TYPES, maxBytes: MAX_PHOTO_BYTES });
  if (!listingPick.ok) errors.listings = listingPick.error;
  else if (listingPick.items.length && parsed.ok && !listingsAllowed(parsed.value.category)) errors.listings = "Listings can't be added for this type of business.";
  return listingPick;
}

/** Inline preview photos stop at this many bytes in total (they ride in the page as data: URIs). */
const PREVIEW_INLINE_BYTES = 12 * 1024 * 1024;
/** Browsers can show these inline (HEIC/HEIF can't). */
const PREVIEW_INLINE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /preview[?site=<slug>]  "Preview my website" (2026-11-20): the builder
 * posts the form as it is (new tab) and gets the site rendered by the SAME
 * renderSite as the live site, with a "Preview — not published yet" bar and
 * noindex. It NEVER writes: no KV, R2 or D1, no account, no site, no address
 * reserved, no charge, no rate-limit counter.
 *
 * The text goes through parseContent, exactly as create validates it (facts
 * only, no links, sizes); errors -> a page listing what to fix. Photos are
 * never R2 keys from the form: new uploads are shown inline from this request
 * (data: URIs, checked like create, JPEG/PNG/WebP, 12 MB total); an AdVault
 * draft's photos only when the draft is the signed-in account's
 * (`sessionDraft`) and only its own keys (served by the session-gated draft
 * route); the edit page's kept photos only when the caller may edit that site
 * (`authorize`: edit key or owner session) and only keys that site has.
 * Video, before & after, menu, schedule and listings are not previewed (a
 * note says they show after saving). Same-origin posts only.
 */
async function previewSite(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, env.PUBLIC_ORIGIN)) return html(messagePage("Preview", "Please use the Preview button on the build page.", "Preview"), 403);
  const form = await readForm(request);
  if (!form) return html(previewErrorsPage({ form: "Please use the Preview button on the build page." }), 400);
  const parsed = parseContent(form.fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  const photoErr = checkPhotos(form.files, 0);
  if (photoErr) errors.photos = photoErr;
  if (!parsed.ok || Object.keys(errors).length) return html(previewErrorsPage(errors), 400);

  // Existing photos the caller may show (never an arbitrary key).
  const shown: string[] = [];
  let base: Site | null = null;
  const editSlug = url.searchParams.get("site");
  if (editSlug && /^[a-z0-9-]+$/.test(editSlug)) {
    base = await authorize(env, editSlug, form.fields.key ?? "", request);
    // From this origin's /p/: the preview is served here under img-src 'self', so the customer host's URL would be blocked.
    if (base) for (const k of form.keep) if (base.photos.includes(k)) shown.push(photoUrl({ ...renderCtx(env, base.slug), assetOrigin: env.PUBLIC_ORIGIN }, k));
  } else if (form.fields.draft) {
    const own = await sessionDraft(request, env, form.fields.draft);
    if (own) {
      const keys = new Set(own.draft.photos.map((p) => p.key));
      for (const k of form.keepDraft) if (keys.has(k)) shown.push(`${env.PUBLIC_ORIGIN}/embed/draft/${own.draft.id}/${k.split("/").pop()}`);
    }
  }
  // New uploads, inline from this request only.
  let inlineBytes = 0;
  let skipped = 0;
  for (const f of form.files) {
    if (shown.length >= MAX_PHOTOS || !PREVIEW_INLINE_TYPES.includes(f.type) || inlineBytes + f.size > PREVIEW_INLINE_BYTES) {
      skipped += 1;
      continue;
    }
    inlineBytes += f.size;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    shown.push(`data:${f.type};base64,${btoa(bin)}`);
  }

  const slug = (form.fields.slug && normaliseAddress(form.fields.slug)) || base?.slug || "your-business";
  const now = new Date().toISOString();
  const site: Site = {
    ...(base ? { reviews: base.reviews, policies: base.policies } : {}),
    ...parsed.value,
    slug,
    photos: shown,
    status: "live",
    source: base?.source ?? (form.fields.draft ? "advault" : "web"),
    editKeyHash: "",
    createdAt: base?.createdAt ?? now,
    updatedAt: now,
  };
  const n = nonce();
  const ctx = { ...renderCtx(env, slug), ping: false, nonce: n, photoSrc: (k: string) => k };
  const notes = [
    "Preview — not published yet. Nothing is saved until you press the button on the build page.",
    skipped ? `${skipped} photo${skipped === 1 ? "" : "s"} can't be shown here and will appear after you save.` : "",
    "Video, before & after photos, menus and listings show after you save.",
  ].filter(Boolean);
  // Same bar, noindex and frame-safe links as the owner view (it may open in the edit page's right side).
  const res = html(ownerFrame(renderSite(site, ctx), notes, ctx.siteUrl), 200, n);
  res.headers.set("x-robots-tag", "noindex");
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

async function createSite(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const form = await readForm(request);
  const signedIn = await currentAccount(env.SITES, request);
  const mode = { kind: "new", account: signedIn, publishesNow: newSitePublishes(env, signedIn) } as const;
  if (!form) return rejected(request, env, mode, { form: "Please use the form." }, {});
  const { fields, files } = form;
  // Accounts: signed in = the site goes to that account; otherwise sign up here.
  const acctEmail = normaliseEmail(fields.acct_email ?? "");
  const acctPassword = fields.acct_password ?? "";

  const parsed = parseContent(fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  if (fields.attest !== "yes") errors.attest = "Please confirm this.";
  const photoErr = checkPhotos(files, 0);
  if (photoErr) errors.photos = photoErr;
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) {
    errors.video = `Use one MP4 video, up to ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`;
  }
  // Before & after pairs (builder, only trades where they fit): both photos and
  // the "our own work" tick. Same rules as the edit page; stored separately.
  const pairs = pickBeforeAfter(form.ba, { existing: 0, types: PHOTO_TYPES, maxBytes: MAX_PHOTO_BYTES });
  if (!pairs.ok) errors.beforeAfter = pairs.error;
  else if (pairs.pairs.length) {
    if (parsed.ok && !beforeAfterAllowed(parsed.value.category)) errors.beforeAfter = "Before & after photos are not available for this type of business.";
    else if (fields.baAttest !== "yes") errors.baAttest = "Please confirm these are real photos of your own work.";
  }
  const listingPick = builderExtrasChecks(form, parsed, errors);
  const requested = fields.slug ? normaliseAddress(fields.slug) : null;
  if (requested) {
    const problem = await requestedAddressProblem(env, requested);
    if (problem) errors.slug = problem;
  }
  if (signedIn && !isAdminEmail(env, signedIn.email) && (await accountSites(env, signedIn)).length > 0) {
    errors.form = "Your account already has a website (one per account). Open My website to edit it.";
  }
  if (!signedIn) {
    const ep = emailProblem(acctEmail);
    if (ep) errors.acct_email = ep;
    else if (await accountByEmail(env.SITES, acctEmail)) errors.acct_email = "This email already has an account. Sign in first (link above), then build your website.";
    const pp = passwordProblem(acctPassword);
    if (pp) errors.acct_password = pp;
  }
  // Never echo the password back into the form.
  const { acct_password: _pw, ...safeFields } = fields;
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, safeFields);

  if (await rateLimited(request, env)) {
    return rejected(request, env, mode, { form: "Too many websites created from this connection today. Try again tomorrow." }, fields, 429);
  }

  // Reserved before the sign-up, so losing the address doesn't leave an account
  // behind that then blocks the retry ("this email already has an account").
  const address = await reserveNewAddress(env, parsed.value, requested);
  if (!address) return rejected(request, env, mode, { slug: ADDRESS_TAKEN }, safeFields);

  let owner: Account | null = signedIn;
  if (!owner) {
    const made = await signUpShared(env.SITES, advaultApi(env), acctEmail, acctPassword).catch(async (err: unknown) => {
      await releaseAddress(env, address);
      throw err;
    });
    if (made === "exists") await releaseAddress(env, address);
    if (made === "exists") return rejected(request, env, mode, { acct_email: "This email already has a 3PandaLabs account (SiteVault or AdVault). Sign in first, then build your website." }, safeFields, 409);
    owner = made;
    console.log("account_created", { id: made.id });
  }
  const { slug, editUrl, key, pending } = await insertSite(env, parsed.value, files, "web", form.video, address, false, owner.id, isAdminEmail(env, owner.email), isAdminEmail(env, owner.email), pairs.ok ? pairs.pairs : [], form.menu, form.schedule, listingPick.ok ? listingPick.items : []);
  await addSiteToAccount(env.SITES, owner, slug);
  reportSitevaultUse(env, ctx, owner);
  const sessionCookieFor = signedIn ? null : await startSession(env.SITES, owner.id);
  // BILLING on: the site waits for payment; the done page offers Publish.
  const publish = pending ? { slug, key, prices: planPrices("web", festiveOpen(billingConfig(env), new Date())) } : undefined;
  const n = nonce();
  const page = donePage({ siteUrl: siteUrl(env, slug), editUrl, nonce: n, publish, signedIn: true, admin: isAdminEmail(env, owner.email) });
  // The done page carries the only copy of the edit key: render it straight
  // into this response rather than redirecting with the key in a URL that
  // ends up in history. The script path gets the same page via a one-time
  // KV handoff that expires in 10 minutes.
  if (wantsJson(request)) {
    const handoff = randomKey(18);
    await env.SITES.put(`done:${handoff}`, JSON.stringify({ siteUrl: siteUrl(env, slug), editUrl, ...(publish ? { publish } : {}) }), {
      expirationTtl: 600,
    });
    const res = json({ ok: true, next: `/done/${handoff}` });
    return sessionCookieFor ? withSession(res, sessionCookieFor) : res;
  }
  const res = html(page, 201, n);
  return sessionCookieFor ? withSession(res, sessionCookieFor) : res;
}

// Upload menu file(s) on their own from the edit page, without saving the whole
// form — the owner clicks "Upload menu" and the thumbnail appears at once. The
// edit key (or owner session) authorises; files are validated and appended.
async function uploadMenu(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  if (!form) return json({ ok: false, error: "Please use the form." }, 400);
  const site = await authorize(env, slug, form.fields.key ?? "", request);
  if (!site) return json({ ok: false, error: "Your edit link isn't valid any more. Reload it and try again." }, 403);
  if (!form.menu.length) return json({ ok: false, error: "Choose a file first." }, 400);
  if (!menuAllowed(site.category)) return json({ ok: false, error: "A menu can't be added for this type of business." }, 400);
  const problem = checkMenu(form.menu, (site.menu ?? []).length);
  if (problem) return json({ ok: false, error: problem }, 400);
  const stored = await storeMenu(env, slug, form.menu);
  // Re-read the freshest copy so a concurrent edit isn't clobbered.
  const fresh = (await loadSite(env, slug)) ?? site;
  const menu = [...(fresh.menu ?? []), ...stored];
  await saveSite(env, { ...fresh, menu, updatedAt: new Date().toISOString() });
  return json({ ok: true, menu: menu.map((k) => ({ key: k, url: `${env.PUBLIC_ORIGIN}/p/${k}`, pdf: isMenuPdf(k) })) });
}

async function updateSite(request: Request, env: Env, slug: string): Promise<Response> {
  const form = await readForm(request);
  if (!form) return json({ ok: false, errors: { form: "Please use the form." } }, 400);
  const site = await authorize(env, slug, form.fields.key ?? "", request);
  if (!site) {
    return wantsJson(request)
      ? json({ ok: false, errors: { form: "Your edit link isn't valid any more. Reload it and try again." } }, 403)
      : html(messagePage("Edit link not valid", "Reload your edit link and try again.", "Can't save"), 403);
  }
  const embed = form.fields.embed === "1";
  const mode = await editMode(env, site, form.fields.key ?? "", false, embed);

  const parsed = parseContent(form.fields);
  const errors: FieldErrors = parsed.ok ? {} : { ...parsed.errors };
  // Offer credits (BILLING on): a new, different, non-empty offer costs 1.
  const cfg = billingConfig(env);
  const spend = parsed.ok ? offerSpend(site.offer, parsed.value.offer, billingOf(site).credits, cfg.on) : ({ ok: true, spend: 0 } as const);
  if (!spend.ok) {
    errors.offer = embed
      ? "Changing your special uses 1 credit and you have none left. Keep the current special for now."
      : "Changing your special uses 1 credit and you have none left. Buy more credits in Plan & billing above, or keep the current special.";
  }
  // Keep the order the owner arranged (form.keep is in the edit page's DOM order),
  // filtered to this site's real photo keys.
  const kept = form.keep.filter((k) => site.photos.includes(k));
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
  if (form.video && (form.video.type !== "video/mp4" || form.video.size > MAX_VIDEO_BYTES)) {
    errors.video = `Use one MP4 video, up to ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`;
  }
  // Class schedule (fitness): one uploaded timetable, replaced on re-upload.
  if (form.schedule && parsed.ok && !scheduleAllowed(parsed.value.category)) errors.schedule = "A schedule can't be added for this type of business.";
  else {
    const schedProblem = checkScheduleFile(form.schedule);
    if (schedProblem) errors.schedule = schedProblem;
  }
  // Featured listings (real estate): keep existing by photo key, add new slots.
  const listingsNow = site.listings ?? [];
  const keptListings = listingsNow.filter((l) => form.keepListing.includes(l.photo));
  const listingPick = pickListings(listingSlots(form), { existing: keptListings.length, types: PHOTO_TYPES, maxBytes: MAX_PHOTO_BYTES });
  if (!listingPick.ok) errors.listings = listingPick.error;
  else if (listingPick.items.length && parsed.ok && !listingsAllowed(parsed.value.category)) errors.listings = "Listings can't be added for this type of business.";
  // Before & after: untick to remove a pair; add new ones only for trades
  // where they fit, with both photos and the "our own work" tick.
  const pairsNow = site.beforeAfter ?? [];
  const keptPairs = pairsNow.filter((p) => form.keepPair.includes(p.before));
  const newPairs = pickBeforeAfter(form.ba, { existing: keptPairs.length, types: PHOTO_TYPES, maxBytes: MAX_PHOTO_BYTES });
  if (!newPairs.ok) errors.beforeAfter = newPairs.error;
  else if (newPairs.pairs.length) {
    if (parsed.ok && !beforeAfterAllowed(parsed.value.category)) errors.beforeAfter = "Before & after photos are not available for this type of business.";
    else if (form.fields.baAttest !== "yes") errors.baAttest = "Please confirm these are real photos of your own work.";
  }
  // Menu files (restaurants/bakeries): untick to remove one, upload to add,
  // image or PDF, stored as-is.
  const menuNow = site.menu ?? [];
  const keptMenu = menuNow.filter((k) => form.keepMenu.includes(k));
  if (form.menu.length && parsed.ok && !menuAllowed(parsed.value.category)) errors.menu = "A menu can't be added for this type of business.";
  else {
    const menuProblem = checkMenu(form.menu, keptMenu.length);
    if (menuProblem) errors.menu = menuProblem;
  }
  if (Object.keys(errors).length > 0 || !parsed.ok) return rejected(request, env, mode, errors, form.fields);

  // Reserved before anything is stored. Its own old address is already its own.
  const reserve = renaming && !(site.aliases ?? []).includes(wanted);
  if (reserve && !(await reserveAddress(env, wanted))) return rejected(request, env, mode, { slug: ADDRESS_TAKEN }, form.fields);

  const removed = site.photos.filter((k) => !kept.includes(k));
  for (const p of pairsNow) if (!keptPairs.includes(p)) removed.push(p.before, p.after);
  for (const k of menuNow) if (!keptMenu.includes(k)) removed.push(k);
  const addedMenu = form.menu.length ? await storeMenu(env, slug, form.menu) : [];
  const menu = [...keptMenu, ...addedMenu];
  for (const l of listingsNow) if (!keptListings.includes(l)) removed.push(l.photo);
  const addedListings = listingPick.ok ? await storeListings(env, slug, listingPick.items) : [];
  const listings = [...keptListings, ...addedListings];
  const addedPairs = newPairs.ok ? await storePairs(env, slug, newPairs.pairs) : [];
  const beforeAfter = [...keptPairs, ...addedPairs];
  const added = await storePhotos(env, slug, form.files);
  // A new upload replaces the current video; otherwise keep it unless "keep" was unticked.
  let video = site.video ?? null;
  if (form.video) {
    video = await storeVideo(env, slug, form.video);
    if (site.video) removed.push(site.video);
  } else if (site.video && form.fields.keepVideo !== "yes") {
    removed.push(site.video);
    video = null;
  }
  // A new schedule replaces the current one; otherwise keep it unless unticked.
  let schedule = site.schedule ?? null;
  if (form.schedule) {
    schedule = (await storeMenu(env, slug, [form.schedule]))[0] ?? null;
    if (site.schedule) removed.push(site.schedule);
  } else if (site.schedule && form.fields.keepSchedule !== "yes") {
    removed.push(site.schedule);
    schedule = null;
  }
  // Billing may have changed while the owner was editing (a webhook landed):
  // start from the freshest copy so a save never undoes a payment.
  const fresh = (await loadSite(env, slug))?.billing ?? site.billing;
  let billing = fresh;
  if (spend.ok && spend.spend === 1) {
    const b = billingOf({ billing: fresh });
    if (b.credits < 1 && reserve) await releaseAddress(env, wanted);
    if (b.credits < 1) return rejected(request, env, mode, { offer: embed ? "You have no offer credits left." : "You have no offer credits left. Buy more in Plan & billing above." }, form.fields, 402);
    billing = { ...b, credits: b.credits - 1 };
  }
  const next: Site = {
    ...site,
    ...parsed.value,
    ...(billing ? { billing } : {}),
    photos: [...kept, ...added],
    video,
    updatedAt: new Date().toISOString(),
  };
  if (beforeAfter.length) next.beforeAfter = beforeAfter;
  else delete next.beforeAfter;
  if (menu.length) next.menu = menu;
  else delete next.menu;
  if (schedule) next.schedule = schedule;
  else delete next.schedule;
  if (listings.length) next.listings = listings;
  else delete next.listings;
  if (renaming) {
    const aliases = [...new Set([...(site.aliases ?? []), site.slug])].filter((a) => a !== wanted);
    next.slug = wanted;
    next.aliases = aliases;
    next.renames = (site.renames ?? 0) + 1;
    await saveSite(env, next);
    // Hold the old address while KV settles: for a minute another location may
    // see neither the deleted site nor the new alias.
    await env.PHOTOS.put(addrKey(site.slug), randomKey(16));
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

  // Embedded in AdVault: back to the embed editor (it says "Saved"), never
  // off to the public site inside AdVault's frame.
  const target = embed ? `${env.PUBLIC_ORIGIN}/edit/${encodeURIComponent(next.slug)}?embed=1&saved=1` : siteUrl(env, next.slug);
  // The tabbed edit page (pages.ts OWNER_TABS_SCRIPT) reloads itself after a
  // save so the right-side view shows the saved site; `edit` is where (a
  // rename moves it). The no-JS post still goes to the public site.
  return wantsJson(request)
    ? json({ ok: true, next: target, ...(embed ? {} : { edit: `${env.PUBLIC_ORIGIN}/edit/${encodeURIComponent(next.slug)}` }) })
    : Response.redirect(target, 303);
}

// No self-service delete (2026-11-15, owner's decision): owners email
// sitevault@3pandalabs.com; ops confirms by phone, cancels any Stripe renewal,
// checks for an AdVault ad linking here, then uses the admin takedown route.
async function removeSite(env: Env, site: Site): Promise<void> {
  // Keep the record (status removed) so the slug isn't handed to someone else
  // and an abuse report can still be traced; the content is the photos.
  await deletePhotos(env, siteFileKeys(site));
  const { beforeAfter: _pairs, ...rest } = site;
  await saveSite(env, { ...rest, photos: [], video: null, status: "removed", updatedAt: new Date().toISOString() });
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
    // null: a Worker has no long-lived process, and Date.now() at module
    // scope is 0 in Workers, so "now - start" reported ~56 years. The admin
    // page shows null as "—".
    uptimeSeconds: null,
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
