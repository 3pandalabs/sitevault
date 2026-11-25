// SiteVault's own pages: home, the builder (new + edit), done, privacy, terms.
// Server-rendered HTML. The builder has one small inline script (CSP nonce)
// that shrinks photos in the browser before upload, so a 12 MB phone photo
// arrives as ~300 KB; without JavaScript the form still posts normally.

import {
  BEFORE_AFTER_FIELDS,
  CATEGORIES,
  HOURS_TEMPLATE,
  MAX_BEFORE_AFTER,
  MAX_LOCATIONS,
  INSURANCE_CATEGORIES,
  LISTING_CATEGORIES,
  LISTING_SLOTS,
  LISTING_STATUSES,
  MAX_FAQ,
  MAX_LISTINGS,
  MAX_MENU,
  MAX_PHOTOS,
  MAX_TEAM,
  MENU_CATEGORIES,
  SCHEDULE_CATEGORIES,
  SERVICE_TEMPLATES,
  TEAM_CATEGORIES,
  beforeAfterAllowed,
  insuranceAllowed,
  isMenuPdf,
  listingsAllowed,
  locationsToText,
  menuAllowed,
  scheduleAllowed,
  faqToText,
  servicesToText,
  teamAllowed,
  teamToText,
  type CategoryKey,
  type FieldErrors,
  type Listing,
  type Review,
  type Site,
} from "./site.js";
import { DEFAULT_TEMPLATE, TEMPLATES, themeFor } from "./templates.js";
import { SW_REGISTER } from "./pwa.js";

/** Category -> picker-thumbnail colours (primary + light band), so the style previews match the business type. */
const CAT_THUMB_COLORS: Record<string, { p: string; b: string }> = Object.fromEntries(
  Object.entries(CATEGORIES).map(([k, c]) => {
    const t = themeFor(k as CategoryKey, c.brand);
    return [k, { p: t.primary, b: t.band }];
  }),
);

/** Quick-pick brand colours for the builder — all clear 4.5:1 white-text contrast. */
const BRAND_PRESETS = [
  "#1e3a8a", "#0f766e", "#15803d", "#b45309", "#b91c1c",
  "#be185d", "#6d28d9", "#0c4a6e", "#9a3412", "#334155",
];
import { MAX_RENAMES } from "./address.js";
import { esc } from "./util.js";
import type { HelpTopic } from "./help.js";
import { SUGGEST_SCRIPT, suggestChips, type SuggestContext } from "./suggest.js";
import { EMBED_SCRIPT } from "./embed.js";
import { chartCard, type Row } from "./charts.js";
import { DOLLARS, PACK_CREDITS, planCovers, type Billing, type CheckoutKind, type PlanPrices, type SiteState, type Source } from "./billing.js";
import type { SiteStats } from "./stats.js";

const CONTACT = "sitevault@3pandalabs.com";

/** The main site's origin, for share tags (og:url / og:image need absolute URLs). */
const SITE_ORIGIN = "https://sitevault.3pandalabs.com";
const DESCRIPTION = "A simple website for your local business in about five minutes. Built from your own details and photos.";

/**
 * Open Graph + Twitter share tags (brand consistency rules, 2026-11-22) for
 * SiteVault's OWN public pages. Customer sites never use this layout.
 * `/og.png` is the brand 1200x630 card, served same-origin by index.ts.
 */
function shareTags(title: string, path: string): string {
  return `<meta property="og:type" content="website">
<meta property="og:site_name" content="SiteVault by 3PandaLabs">
<meta property="og:url" content="${esc(SITE_ORIGIN + path)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:image" content="${SITE_ORIGIN}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="SiteVault: a website for your business in 5 minutes. By 3PandaLabs.">
<meta name="twitter:card" content="summary_large_image">`;
}

/** `owner`: a signed-in owner who already has their website (one per account): no "Build" button. */
/**
 * `embed`: the page sits in AdVault's "Your website" iframe. No SiteVault
 * header, nav, sign-in or footer (AdVault has its own), and the body takes its
 * content's height so the iframe can fit it.
 *
 * `path`: set on public pages only; adds the share tags (og:url is the main
 * site origin + this path).
 */
/** Where html() (index.ts) puts the panda helper's nonce'd script. Never on embedded, admin or message pages. */
export const HELPER_MARK = "<!--helper-->";

export function layout(opts: { helper?: boolean; title: string; body: string; path?: string; nonce?: string; script?: string; noindex?: boolean; owner?: boolean; signedIn?: boolean; admin?: boolean; embed?: boolean; email?: string | null }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${opts.embed ? "" : `<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="SiteVault">`}
<title>${esc(opts.title)}</title>
<meta name="description" content="${DESCRIPTION}">
${opts.path !== undefined && !opts.embed ? shareTags(opts.title, opts.path) : ""}
${opts.noindex ? '<meta name="robots" content="noindex">' : ""}
<meta name="theme-color" content="#09090b">
<meta name="color-scheme" content="dark">
<style>
/* The org's app chrome (same system as AdVault, RsvpVault, MealMargin):
   dark zinc, three blurred blobs + dot grid, wordmark with the "by 3PandaLabs"
   tag, rounded-xl buttons, canonical footer. SiteVault's register is sky +
   violet, the way AdVault's is amber + violet. Customer sites are NOT styled
   like this: they are the business's own, light and coloured per category. */
:root{--bg:#09090b;--fg:#f4f4f5;--fg2:#d4d4d8;--muted:#a1a1aa;--dim:#71717a;--line:rgba(255,255,255,.10);--line2:rgba(255,255,255,.15);--panel:rgba(255,255,255,.03);--accent:#38bdf8;--accent-hi:#7dd3fc;--on-accent:#09090b;--err:#fca5a5;--ok-bg:rgba(52,211,153,.08);--ok-line:rgba(52,211,153,.3)}
*{box-sizing:border-box}
/* overflow-x:clip (not hidden) stops horizontal scroll WITHOUT making the body a
   scroll container — hidden broke position:sticky (the live-preview panel never
   floated). clip is the same fix the customer-site renderer uses; hidden stays
   as a fallback for old browsers. */
html,body{max-width:100vw;overflow-x:hidden;overflow-x:clip}
body{margin:0;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;color:var(--fg);background:var(--bg);line-height:1.6;font-size:16px;min-height:100vh;display:flex;flex-direction:column}
.backdrop{pointer-events:none;position:fixed;inset:0;z-index:-1;overflow:hidden;background:var(--bg)}
.backdrop i{position:absolute;border-radius:9999px;filter:blur(64px)}
.backdrop .b1{top:-10rem;left:-8rem;width:32rem;height:32rem;background:rgba(14,165,233,.20)}
.backdrop .b2{top:-6rem;right:-10rem;width:28rem;height:28rem;background:rgba(124,58,237,.20)}
.backdrop .b3{bottom:-14rem;left:33%;width:34rem;height:34rem;background:rgba(56,189,248,.10)}
.backdrop .dots{position:absolute;inset:0;opacity:.04;background-image:radial-gradient(circle,#f4f4f5 1px,transparent 1px);background-size:24px 24px}
.wrap{width:100%;max-width:64rem;margin:0 auto;padding:0 24px}
main{flex:1}
a{color:var(--accent-hi)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.signed-in{max-width:16rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg2);font-size:.875rem}@media (max-width:640px){.signed-in{display:none}}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:24px;padding-bottom:24px;gap:12px}
.brand{font-size:1.125rem;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.logo{color:var(--fg);text-decoration:none}
.logo span{color:var(--accent)}
.tag{display:inline-block;margin-left:8px;padding-left:8px;border-left:1px solid rgba(244,244,245,.2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.1em;color:var(--dim);text-decoration:none;vertical-align:middle}
.tag:hover{color:var(--fg2);text-decoration:underline}
/* Header "by 3PandaLabs": shown UPPERCASE (source text stays "by 3PandaLabs")
   and never hidden at any width: on a phone it shrinks, and wraps below the
   wordmark as one unit if there's no room. */
.brand .tag{text-transform:uppercase;white-space:nowrap}
@media (max-width:640px){.brand{white-space:normal;min-width:0}.brand .tag{margin-left:6px;padding-left:6px;font-size:9px;letter-spacing:.06em}}
nav.links{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;align-items:center;font-size:.875rem}
nav.links form{margin:0}
nav.links button.plain{background:none;border:0;font:inherit;color:var(--fg2);padding:8px 12px;border-radius:8px;cursor:pointer;min-height:44px}
nav.links button.plain:hover{background:rgba(255,255,255,.10)}
nav.links a.plain{color:var(--fg2);text-decoration:none;padding:8px 12px;border-radius:8px}
nav.links a.plain:hover{background:rgba(255,255,255,.10)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 20px;border-radius:12px;font-weight:600;text-decoration:none;border:1px solid transparent;background:var(--accent);color:var(--on-accent);font-size:1rem;cursor:pointer;font-family:inherit}
.btn:hover{background:var(--accent-hi)}
.btn.small{min-height:36px;padding:6px 12px;font-size:.875rem;border-radius:8px}
.btn.ghost{background:transparent;color:var(--fg2);border-color:var(--line2)}
.btn.ghost:hover{background:rgba(255,255,255,.10)}
.btn[disabled]{opacity:.6;cursor:progress}
.hero{padding:40px 0 48px}
.hero h1{font-size:clamp(2.25rem,6vw,3.75rem);line-height:1.08;letter-spacing:-.025em;font-weight:600;margin:0 0 20px;max-width:48rem;text-wrap:balance}
h1{font-weight:600;letter-spacing:-.02em}
h2{font-size:1.5rem;font-weight:600;letter-spacing:-.015em}
.lead{font-size:1.125rem;color:var(--fg2);margin:0 0 28px;max-width:42rem}
.price{font-size:1.25rem;font-weight:600;margin:0 0 20px}.price b{color:var(--accent)}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:16px;margin:0 0 12px;max-width:860px}
.included{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:16px 20px}
.included.pro{border-color:var(--accent)}
.included h2{font-size:1.1rem;margin:0 0 4px}
.plan-price{font-size:1.25rem;font-weight:700;margin:0 0 10px;color:var(--accent)}
.plan-price s{color:var(--muted);font-weight:400;font-size:1rem}
.plan-price .tag{font-size:.8rem;font-weight:500;color:var(--muted)}
.plan-sub{margin:0 0 8px;font-size:.9rem}
.included{display:flex;flex-direction:column}
.plan-note{margin:0 0 8px;font-size:.95rem}
.included ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.included li{color:var(--muted);font-size:.95rem;padding-left:22px;position:relative}
.included li::before{content:"✓";position:absolute;left:0;color:var(--accent);font-weight:700}
.steps{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));padding:8px 0 40px}
.card{border:1px solid var(--line);border-radius:16px;padding:20px;background:var(--panel)}
.card h3{margin:0 0 6px;font-size:1rem;font-weight:600}
.card p{margin:0;color:var(--muted);font-size:.95rem}
.pill{display:inline-block;border:1px solid rgba(56,189,248,.3);background:rgba(56,189,248,.10);color:#bae6fd;font-weight:500;border-radius:999px;padding:4px 12px;font-size:.75rem;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px}
section{padding:24px 0}
form .field{margin:0 0 18px}
label{display:block;font-weight:500;margin-bottom:6px;color:var(--fg)}
.hint{display:block;font-weight:400;color:var(--muted);font-size:.85rem}
input[type=text],input[type=tel],input[type=email],input[type=password],input[type=url],select,textarea,input[type=file]{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line2);border-radius:10px;background:rgba(255,255,255,.05);color:var(--fg)}
select option{background:#18181b}
input::placeholder,textarea::placeholder{color:var(--dim)}
textarea{min-height:110px;resize:vertical}
.suggest{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.suggest:empty{display:none}
.suggest-chip{max-width:100%;min-height:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.3);color:#bae6fd;border-radius:999px;padding:8px 14px;font:inherit;font-size:.875rem;cursor:pointer;touch-action:manipulation}
.suggest-chip:hover{background:rgba(56,189,248,.16)}.suggest-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.err{color:var(--err);font-size:.9rem;margin-top:4px}
.err:empty{display:none}
.row{display:grid;gap:0 16px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))}
.addr{display:flex;align-items:center;border:1px solid var(--line2);border-radius:10px;background:rgba(255,255,255,.05);overflow:hidden}
.addr span{padding:0 10px;color:var(--muted);font-size:.9rem;white-space:nowrap}
.addr input{border:0 !important;border-radius:0 !important;background:transparent !important;padding-left:0 !important;padding-right:0 !important;min-width:0;flex:1}
.addr:focus-within{outline:2px solid var(--accent);outline-offset:2px}
#slug-status{margin-top:4px}#slug-status .ok{color:#6ee7b7;background:none;border:0}#slug-status .bad{color:var(--err)}
#slug-status button{background:none;border:1px solid var(--line2);color:var(--fg2);border-radius:999px;padding:2px 10px;margin:4px 6px 0 0;font:inherit;font-size:.85rem;cursor:pointer}
fieldset{min-width:0;border:1px solid var(--line);border-radius:16px;padding:18px 18px 4px;margin:0 0 20px;background:var(--panel)}
legend{font-weight:600;padding:0 6px}
#builder{margin-bottom:32px}
.photos{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}
.menu-upload{margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.photo{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:.85rem}
.photo[draggable=true]{cursor:grab}
.photo.dragging{opacity:.5;cursor:grabbing}
.photo img{width:110px;height:82px;object-fit:cover;border-radius:8px;border:1px solid var(--line2);pointer-events:none}
.photo.dragging img{outline:2px dashed var(--accent);outline-offset:2px}
.photo-ctl{display:flex;align-items:center;gap:6px}
.pmove{width:28px;height:28px;border-radius:7px;border:1px solid var(--line2);background:var(--panel);color:var(--fg2);cursor:pointer;font-size:.95rem;line-height:1;padding:0}
.pmove:hover{color:var(--fg);border-color:var(--fg2)}
.pkeep{display:flex;align-items:center;gap:4px;font-weight:400;min-height:44px}
.premove{min-height:40px;padding:0 12px;border:1px solid var(--line2);border-radius:8px;background:var(--panel);color:#f87171;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600}
.premove:hover{border-color:#f87171;background:rgba(248,113,113,.1)}
.clearfield{display:inline-block;margin-top:6px;background:none;border:0;color:var(--fg2);cursor:pointer;font:inherit;font-size:.82rem;text-decoration:underline;padding:4px 0}
.clearfield:hover{color:var(--fg)}
.clearfield[hidden]{display:none}
.ba-thumbs{display:flex;gap:4px}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;color:var(--fg2)}
.check input{margin-top:5px;width:18px;height:18px;accent-color:var(--accent)}
.notice{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.ok{background:var(--ok-bg);border-color:var(--ok-line)}
.copybox{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.copybox code{background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:8px;padding:8px 10px;overflow-wrap:anywhere;flex:1;min-width:0;font-size:.875rem;color:var(--fg)}
footer{border-top:1px solid var(--line);margin-top:48px;padding:32px 0;font-size:.875rem}
footer .links{display:flex;flex-wrap:wrap;gap:8px 20px;padding-bottom:16px}
footer .links a{color:var(--muted);text-decoration:none}footer .links a:hover{color:var(--fg2)}
footer .follow{display:flex;align-items:center;gap:10px;color:var(--muted);margin-left:auto}footer .follow svg{display:block}@media (max-width:640px){footer .follow{margin-left:0;flex-basis:100%}}
footer .legal{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;color:var(--dim)}
footer .tagline{margin:8px 0 0;color:var(--dim);font-size:.8rem}
.prose{max-width:46rem}.prose h2{margin-top:28px;font-size:1.25rem}.prose li,.prose p{color:var(--fg2)}
.panel{border:1px solid var(--line);border-radius:16px;padding:18px;margin:0 0 20px;background:var(--panel)}
.panel h2{margin:0 0 10px;font-size:1.25rem}
.panel p{margin:0 0 10px;color:var(--fg2)}
details.section{border:1px solid var(--line);border-radius:16px;background:var(--panel);margin:0 0 20px}
details.section>summary{list-style:none;cursor:pointer;padding:16px 18px;font-weight:600;display:flex;align-items:center;gap:8px}
details.section>summary::-webkit-details-marker{display:none}
details.section>summary::before{content:"▸";display:inline-block;color:var(--fg2);transition:transform .15s}
details.section[open]>summary::before{transform:rotate(90deg)}
details.section>summary .sum{color:var(--fg2);font-weight:400;font-size:.95rem}
details.section[open]>summary{border-bottom:1px solid var(--line)}
details.section .section-body{padding:14px 18px 4px}
/* Visitors-stats collapsible on /account: pure CSS, opened by its button (#id) */
.vstats{display:none;border:1px solid var(--line);border-radius:16px;background:var(--panel);margin:12px 0 2px;scroll-margin-top:16px}
.vstats:target{display:block}
.vstats-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px 0}
.vstats-close{font-size:.9rem;text-decoration:none;color:var(--fg2);white-space:nowrap}
.vstats-close:hover{text-decoration:underline}
.vstats-body{padding:6px 18px 10px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}
.tab{background:var(--panel);border:1px solid var(--line);color:var(--fg2);border-radius:999px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}
.tab.active{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.tabpanel{margin-top:8px}.tabpanel.hidden{display:none}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:12px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.tile-n{font-size:2rem;font-weight:800;line-height:1}.tile-l{color:var(--fg2);font-size:.9rem;margin-top:6px}
.tablewrap{overflow-x:auto}
.atable{width:100%;border-collapse:collapse;margin-top:4px;min-width:520px}
.atable th,.atable td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.atable thead th{color:var(--muted);font-size:.85rem;font-weight:600}
.atable .n{text-align:right}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.8rem;font-weight:600}
.badge.live{background:rgba(52,211,153,.15);color:#6ee7b7}.badge.unpublished{background:rgba(255,255,255,.1);color:#d4d4d8}.badge.grace{background:rgba(251,191,36,.15);color:#fcd34d}.badge.paused{background:rgba(248,113,113,.15);color:#fca5a5}
.templates{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(160px,100%),1fr));gap:12px;margin-top:8px}
.tpl-item{display:flex;flex-direction:column;gap:8px}
.tpl-preview{font-size:.85rem;font-weight:600;text-align:center;text-decoration:none}
.tpl-preview:hover{text-decoration:underline}
.tpl{position:relative;display:block;border:1px solid var(--line2);border-radius:14px;padding:12px;cursor:pointer;background:var(--panel);transition:border-color .12s,box-shadow .12s,background .12s}
.tpl:hover{border-color:var(--fg2)}
.tpl.sel,.tpl:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 2px var(--accent);background:rgba(56,189,248,.07)}
.tpl:has(input:checked) .tpl-name::after{content:" ✓";color:var(--accent);font-weight:800}
.tpl input{position:absolute;opacity:0;width:0;height:0}
.tpl:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.tpl-thumb{position:relative;display:block;height:60px;border-radius:8px;overflow:hidden;border:1px solid var(--line);margin-bottom:8px}
.templates{--tp:#64748b;--tb:#cbd5e1}
.tpl-spotlight{background:linear-gradient(180deg,var(--tb) 58%,var(--tp) 58%)}
.tpl-split{background:linear-gradient(90deg,var(--tp) 46%,var(--tb) 46%)}
.tpl-editorial{background:linear-gradient(180deg,#fff 66%,var(--tp) 66%)}
.tpl-editorial::before{content:"";position:absolute;top:14px;left:50%;transform:translateX(-50%);width:58%;height:5px;background:var(--tp);border-radius:3px;box-shadow:0 9px 0 color-mix(in srgb,var(--tp) 42%,#fff)}
.tpl-bento{background:var(--tb)}
.tpl-bento::before{content:"";position:absolute;left:6px;top:6px;bottom:6px;width:46%;background:var(--tp);border-radius:6px}
.tpl-bento::after{content:"";position:absolute;right:6px;top:6px;width:40%;height:42%;background:#fff;border-radius:5px;box-shadow:0 26px 0 color-mix(in srgb,var(--tp) 35%,#fff)}
.tpl-minimalist{background:#fff}
.tpl-minimalist::before{content:"";position:absolute;left:10px;top:17px;width:48%;height:5px;background:var(--tp);border-radius:3px;box-shadow:0 11px 0 color-mix(in srgb,var(--tp) 38%,#fff)}
.tpl-minimalist::after{content:"";position:absolute;left:10px;top:40px;width:22%;height:10px;background:var(--tp);border-radius:6px}
.tpl-showcase{background:var(--tp)}
.tpl-showcase::before{content:"";position:absolute;inset:13px 26px;background:#fff;border-radius:6px}
.tpl-compact{background:linear-gradient(180deg,var(--tp) 32%,var(--tb) 32%)}
.tpl-compact::before{content:"";position:absolute;left:8px;right:8px;top:34px;height:18px;background:#fff;border-radius:4px}
.tpl-storefront{background:#fff}
.tpl-storefront::before{content:"";position:absolute;left:0;right:0;top:0;height:11px;background:var(--tp)}
.tpl-storefront::after{content:"";position:absolute;left:8px;right:8px;top:22px;height:30px;background:var(--tb);border-radius:4px}
.tpl-modern-bold{background:var(--tb)}
.tpl-modern-bold::before{content:"";position:absolute;left:0;top:0;bottom:0;width:64%;background:var(--tp)}
.tpl-modern-bold::after{content:"";position:absolute;left:10px;top:15px;width:40%;height:7px;background:#fff;border-radius:3px;box-shadow:0 13px 0 #fff}
.tpl-classic{background:color-mix(in srgb,var(--tb) 70%,#fff)}
.tpl-classic::before{content:"";position:absolute;inset:8px;background:#fff;border:1px solid var(--line);border-radius:5px}
.tpl-classic::after{content:"";position:absolute;left:8px;right:8px;top:8px;height:12px;background:var(--tp);border-radius:5px 5px 0 0}
.tpl-name{display:block;font-weight:700}
.tpl-blurb{display:block;color:var(--fg2);font-size:.85rem;margin-top:2px;line-height:1.35}
.brandcolor{margin-top:16px;padding-top:14px;border-top:1px solid var(--line2)}
.bc-body{margin-top:12px}
.bc-body[hidden]{display:none}
.bc-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.bc-row input[type=color]{width:54px;height:40px;padding:2px;border:1px solid var(--line2);border-radius:8px;background:var(--panel);cursor:pointer}
.bc-swatches{display:flex;gap:8px;flex-wrap:wrap}
.bc-sw{width:30px;height:30px;border-radius:50%;border:2px solid var(--panel);box-shadow:0 0 0 1px var(--line2);cursor:pointer;padding:0}
.bc-sw:hover{transform:scale(1.08)}
.bc-sw:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.buttons{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 4px}
.buttons form{margin:0}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0 0 8px}
dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;color:var(--fg)}
.warn{color:#fcd34d}
.stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))}
table.bars{width:100%;border-collapse:collapse;font-size:.9rem}
table.bars caption{text-align:left;font-weight:600;padding-bottom:6px;color:var(--fg)}
table.bars th,table.bars td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);color:var(--fg2);font-weight:400}
table.bars td.n{text-align:right;white-space:nowrap;width:1%}
.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* Owner edit page: 3 tabs; form + live view side by side from 1024px (2026-11-20). */
.otabs{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 20px;border-bottom:1px solid var(--line)}
.otab{display:inline-flex;align-items:center;min-height:44px;padding:8px 16px;color:var(--fg2);text-decoration:none;font-weight:600;border-bottom:2px solid transparent;margin-bottom:-1px}
.otab:hover{color:var(--fg)}.otab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.otab[aria-selected=true]{color:var(--fg);border-bottom-color:var(--accent)}
.opanels{display:grid;gap:28px;grid-template-columns:minmax(0,1fr)}
.opanels[data-tab]>.opanel{display:none}
.opanels[data-tab=edit]>#edit,.opanels[data-tab=view]>#view,.opanels[data-tab=stats]>#stats{display:block}
.viewbar{display:grid;gap:8px;margin:0 0 12px}.viewbar .buttons{margin:0}
.sv-frame{display:block;width:100%;height:75vh;min-height:480px;border:1px solid var(--line2);border-radius:14px;background:#fff}
/* From 720px the Edit tab pins the live preview beside the form (sticky), so it
   floats alongside the fields as you scroll — not just on wide desktops. */
@media (min-width:720px){
  .opanels:not([data-tab]),.opanels[data-tab=edit]{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  .opanels:not([data-tab])>#stats{grid-column:1/-1}
  .opanels[data-tab=edit]>#view{display:block}
  .opanels:not([data-tab])>#view,.opanels[data-tab=edit]>#view{position:sticky;top:12px;align-self:start}
  .opanels:not([data-tab])>#view .sv-frame,.opanels[data-tab=edit]>#view .sv-frame{height:calc(100vh - 190px)}
}
@media (min-width:1024px){
  section.owner{width:min(calc(100vw - 48px),92rem);margin-left:calc((100% - min(calc(100vw - 48px),92rem))/2)}
}
.statgrid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr));margin:0 0 12px}
.statcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;min-width:0}
.statcard-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}
.statcard h3{margin:0;font-size:1rem}
.viewtoggle{display:inline-flex;border:1px solid var(--line2);border-radius:10px;overflow:hidden}
.viewtoggle[hidden]{display:none}
.viewtoggle button{background:transparent;color:var(--fg2);border:0;font:inherit;font-size:.85rem;font-weight:600;padding:6px 12px;min-height:36px;min-width:44px;cursor:pointer}
.viewtoggle button+button{border-left:1px solid var(--line2)}
.viewtoggle button[aria-pressed=true]{background:var(--accent);color:var(--on-accent)}
.viewtoggle button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.chart{margin:0}.chart svg{display:block;max-width:100%;height:auto}
.chart.pie{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.legend{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:.9rem;color:var(--fg2)}
.legend .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;vertical-align:middle}
.legend .pv{color:var(--muted);margin-left:4px}
.bar{display:block;height:8px;border-radius:4px;background:var(--accent);min-width:2px}
</style>
${opts.embed ? `<style>body{min-height:0}main.wrap{padding-top:8px;padding-bottom:24px}</style>` : ""}
</head>
<body${opts.embed ? ' class="embed"' : ""}>
${opts.embed ? "" : `<div class="backdrop" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><div class="dots"></div></div>
<header class="top"><div class="wrap">
  <div class="brand"><a class="logo" href="/">Site<span>Vault</span></a><a class="tag" href="https://3pandalabs.com" target="_blank" rel="noopener noreferrer">by 3PandaLabs</a></div>
  <nav class="links">${
    opts.signedIn
      ? `<a class="plain" href="/go/advault?to=/dashboard">Video ads</a>${opts.admin ? `<a class="plain" href="/admin">Admin</a>` : ""}<a class="plain" href="/account">My website</a>${opts.admin || !opts.owner ? `<a class="btn small" href="/new">Build my website</a>` : ""}${shownEmail(opts.email) ? `<span class="plain signed-in" title="Signed in">${esc(shownEmail(opts.email)!)}</span>` : ""}<form method="post" action="/logout"><button class="plain" type="submit" style="color:#f87171">Sign out</button></form>`
      : `<a class="btn small" href="/login">Sign in</a>`
  }</nav>
</div></header>`}
<main id="main" class="wrap">
${opts.body}
</main>
${opts.embed ? "" : `<footer><div class="wrap">
  <div class="links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/faq">FAQ</a><a href="/contact">Contact us</a><span class="follow">Follow us <a href="https://www.facebook.com/sitevaultsites" target="_blank" rel="noopener noreferrer" aria-label="Facebook" title="Facebook"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></a> <a href="https://x.com/3pandalabs" target="_blank" rel="noopener noreferrer" aria-label="3PandaLabs on X" title="3PandaLabs on X"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a></span></div>
  <div class="legal"><span>&copy; 3PandaLabs LLC, USA.</span><span>All rights reserved.</span></div>
  <p class="tagline">Built by pandas. Loved by people.</p>
</div></footer>`}
${opts.nonce ? `<script nonce="${opts.nonce}">${opts.script ?? ""}${opts.embed ? "" : SW_REGISTER}</script>` : ""}
${opts.embed || opts.helper === false ? "" : HELPER_MARK}
</body>
</html>`;
}

/** What the yearly price covers (home page). Keep every line true. */
const INCLUDED = [
  "Website created for you in minutes",
  "Hosting included",
  "Your own web address (yourbusiness.3pandasite.com)",
  "Secure HTTPS",
  "Made for phones, with tap-to-call and directions",
  "Edit anytime from your phone",
  "Fully managed: we keep it online, fast and secure",
  "No ads, no cookies, no trackers",
];

/** What Pro adds (home page). Matches what stats.ts actually counts. */
const PRO_EXTRAS = [
  "How many people visit your site, day by day",
  "Where they found you: Google, YouTube, Facebook, Instagram, WhatsApp, your AdVault ad",
  "Which towns and countries they're in, and phone or computer",
  "How many tapped Call or Directions",
  "Still private: counted on our side, no cookies or trackers",
];

const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

/** Basic and Pro side by side (home page). */
function plansBlock(billingOn: boolean, festive: boolean): string {
  const basicPrice = !billingOn
    ? "Free during early access"
    : festive
      ? `$${DOLLARS.festive}/year <s>$${DOLLARS.basic}</s> <span class="tag">price locked for life</span>`
      : `$${DOLLARS.basic}/year`;
  const proPrice = !billingOn
    ? "Free during early access"
    : festive
      ? `$${DOLLARS.festivePro}/year <s>$${DOLLARS.pro}</s> <span class="tag">price locked for life</span>`
      : `$${DOLLARS.pro}/year`;
  return `<div class="plans" id="plans">
  <div class="included"><h2>Basic</h2><p class="plan-price">${basicPrice}</p><p class="plan-sub">Everything included:</p>${list(INCLUDED)}</div>
  <div class="included pro"><h2>Pro</h2><p class="plan-price">${proPrice}</p><p class="plan-sub">Everything in Basic, plus visitor stats:</p>${list(PRO_EXTRAS)}</div>
</div>
<p class="plan-note" style="margin-bottom:24px">Build it free first. You choose Basic or Pro when you publish, and can upgrade to Pro anytime.</p>`;
}

/** The home page's price line. `festiveUntil`: the festive offer's last day, while it's open. */
function priceLine(billingOn: boolean, festiveUntil: Date | null): string {
  if (!billingOn) return "<b>Free</b> during early access.";
  if (festiveUntil) {
    return `<b>Festive season price: $${DOLLARS.festive}/year and Pro: $${DOLLARS.festivePro}/year</b> (price locked for life). Join by ${esc(fmtDate(festiveUntil))}.<br>After that, $${DOLLARS.basic}/year (Pro $${DOLLARS.pro}).<br>Build it free. Pay only when you publish.`;
  }
  return `<b>$${DOLLARS.basic} a year.</b> Build it free. Pay only when you publish.`;
}

/** A real address to show as "Signed in as"; AdVault test accounts (empty or *.invalid) show none. */
export function shownEmail(email?: string | null): string | null {
  const e = (email ?? "").trim();
  return e && !/\.invalid$/i.test(e) ? e : null;
}

export function homePage(billingOn = false, festiveUntil: Date | null = null, owner = false, signedIn = false, admin = false, nonce?: string, email?: string | null): string {
  const who = shownEmail(email);
  return layout({
    owner,
    signedIn,
    admin,
    nonce,
    email,
    title: "SiteVault — A website for your business in 5 minutes | by 3PandaLabs",
    path: "/",
    body: `<section class="hero">
  <span class="pill">Websites for local businesses</span>
  <h1>Your business online in five minutes.</h1>
  <p class="lead">No designer, no tech skills. Tell us what you do, add a few photos, and get a clean, phone-friendly website customers can call you from.</p>
  <p class="price">${priceLine(billingOn, festiveUntil)}</p>
  ${plansBlock(billingOn, festiveUntil !== null)}
  ${signedIn ? `<p class="notice" style="margin:0 0 16px">✓ You're signed in${who ? ` as <b>${esc(who)}</b>` : ""}. ${owner ? "Your website is one tap away." : "Pick up where you left off."}</p>` : ""}
  <div style="display:flex;flex-wrap:wrap;gap:12px">${signedIn ? `<a class="btn" href="/account">${owner ? "Go to my website" : "Go to my account"}</a>` : `<a class="btn" href="/login">Sign in to get started</a>`}<a class="btn ghost" href="#features">What you get</a></div>
  <div class="notice" style="margin-top:20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
    <p style="margin:0;font-size:1.125rem;font-weight:500;line-height:1.5">Want more customers? Get a YouTube video ad, shown to people nearby.<span style="display:block;margin-top:6px;font-size:1rem;font-weight:400;color:var(--fg2)">From your photos, by <a href="https://advault.3pandalabs.com">AdVault</a>. Make your website there and it's $${DOLLARS.advaultSetup} with the first year of Pro included, and longer while your AdVault plan runs.</span></p>
    <a class="btn" href="${signedIn ? "/go/advault?to=/dashboard" : "https://advault.3pandalabs.com"}">Make a YouTube ad, $${DOLLARS.advaultAd}</a>
  </div>
</section>
<section id="how-it-works">
  <h2>Three simple steps</h2>
  <div class="steps">
    <div class="card"><h3>1. Tell us the basics</h3><p>Name, phone, what you offer, where you work, your hours.</p></div>
    <div class="card"><h3>2. Add photos</h3><p>Your shop, your team, your work. Straight from your phone.</p></div>
    <div class="card"><h3>3. Share your link</h3><p>Put it on Google, your ads, your van, your business cards.</p></div>
  </div>
</section>
<section id="features">
  <h2>What's on your site</h2>
  <div class="steps">
    <div class="card"><h3>Tap to call and text</h3><p>Big buttons, made for phones, where most customers find you.</p></div>
    <div class="card"><h3>Services and prices</h3><p>Exactly what you offer, in your own words.</p></div>
    <div class="card"><h3>Hours, area, directions</h3><p>Everything a customer checks before they call.</p></div>
    <div class="card"><h3>Fast and private</h3><p>Loads quickly on any phone. No cookies, no trackers.</p></div>
    <div class="card"><h3>Visitor stats <span class="pill" style="margin:0 0 0 6px;padding:2px 8px;vertical-align:middle">Pro</span></h3><p>How many people visit each day, and how many tapped Call or Directions.</p></div>
    <div class="card"><h3>Where they found you <span class="pill" style="margin:0 0 0 6px;padding:2px 8px;vertical-align:middle">Pro</span></h3><p>Google, YouTube, Facebook, WhatsApp or your AdVault ad, and which towns they're in.</p></div>
  </div>
  <p class="plan-note">Pro features come with the Pro plan. <a href="#plans">Compare Basic and Pro</a>.</p>
</section>`,
  });
}

export type FormMode =
  | {
      kind: "new";
      account?: { email: string } | null;
      admin?: boolean;
      embedDraft?: EmbedDraftView;
      /** Creating puts the site live at once (billing off, an admin, or an AdVault site with nothing to pay). */
      publishesNow?: boolean;
    }
  | { kind: "edit"; site: Site; key: string; photoUrl: (k: string) => string; billing?: BillingView; visitors?: VisitorsView; pendingReviews?: Review[]; signedIn?: boolean; siteUrl?: string; admin?: boolean; embed?: boolean; saved?: boolean };

/**
 * AdVault create mode: the builder inside AdVault's "Make me a website",
 * pre-filled from the campaign's draft (drafts.ts). The draft's photos,
 * before & after pairs and video are shown to keep or drop; the account is
 * the AdVault user's, so no sign-up fields, prices or SiteVault chrome.
 */
export type EmbedDraftView = {
  id: string;
  photos: { key: string; url: string }[];
  pairs: { before: string; after: string }[];
  video: boolean;
};

/** Everything the edit page's "Plan & billing" section shows. Only built while BILLING is on. */
export type BillingView = {
  state: SiteState;
  billing: Billing;
  source: Source;
  prices: PlanPrices;
  /** End of the paid period, counting early access (null = no end date). */
  paidUntil: Date | null;
  /** Back from Stripe Checkout (the webhook may still be on its way). */
  justPaid: boolean;
  /** For tests; defaults to now. */
  now?: Date;
};

/** The edit page's "Visitors" section. `stats` null = stats not available. */
export type VisitorsView = { stats: SiteStats | null; full: boolean };

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

function payButton(slug: string, key: string, kind: CheckoutKind, label: string, ghost = false, confirmAddr?: string): string {
  // Publishing asks first (PUBLISH_CONFIRM_SCRIPT); renewals don't.
  const confirm = confirmAddr !== undefined ? ` data-confirm-publish="publish" data-confirm-addr="${esc(confirmAddr)}"` : "";
  return `<form method="post" action="/api/billing/checkout"${confirm}><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="slug" value="${esc(slug)}"><input type="hidden" name="kind" value="${kind}"><button class="btn${ghost ? " ghost" : ""}" type="submit">${esc(label)}</button></form>`;
}

/** Buttons to publish a SiteVault-made site (done page and edit page). Each asks "Publish now?" first. */
function publishButtons(slug: string, key: string, prices: BillingView["prices"], addr = ""): string {
  const festive = prices.festive ? `<p class="hint">Festive season prices (price locked for life): Basic $${prices.basic}/year (normally $${DOLLARS.basic}), Pro $${prices.pro}/year (normally $${DOLLARS.pro}).</p>` : "";
  return `${festive}<div class="buttons">${
    prices.basic !== null ? payButton(slug, key, "publish_basic", `Publish: $${prices.basic}/year`, false, addr) : ""
  }${payButton(slug, key, "publish_pro", `Publish with Pro: $${prices.pro}/year`, prices.basic !== null, addr)}</div>`;
}

/** Days before the paid time ends when renewing opens. */
export const RENEW_WINDOW_DAYS = 45;

export function billingSection(slug: string, key: string, v: BillingView, siteUrl = ""): string {
  const b = v.billing;
  if (b.comp) {
    return `<details class="section" id="billing">
  <summary>Plan &amp; billing <span class="sum">— Comped (free)</span></summary>
  <div class="section-body">
  <p>This website is comped by 3PandaLabs: it's published free and never expires. Nothing to pay.</p>
  <dl class="facts"><dt>Offer credits</dt><dd>${b.credits} left</dd></dl>
  </div>
</details>`;
  }
  const planName = b.plan === "pro" ? "Pro (keeps your site running, with visitor stats)" : "Basic (keeps your site running)";
  const rows: string[] = [];
  let status = "";
  if (v.state === "unpublished" && v.source === "advault") {
    status = `<p>Your website isn't published yet. Finish in AdVault: pay $${DOLLARS.advaultSetup} (the first year of Pro included, and longer while your AdVault plan runs) on your campaign's website card, and it goes live at once.</p>`;
  } else if (v.state === "unpublished") {
    status = `<p>Your website isn't published yet. Visitors see "This site isn't published yet" until you pay.</p>`;
  } else {
    rows.push(`<dt>Plan</dt><dd>${b.earlyAccess && !b.subscriptionId ? "Early access (free)" : esc(planName)}</dd>`);
    if (v.paidUntil) {
      const label = v.state === "paused" || v.state === "grace" ? "Paid period ended" : b.renewing ? "Renews on" : "Paid until";
      rows.push(`<dt>${label}</dt><dd>${esc(fmtDate(v.paidUntil))}</dd>`);
    }
    if (v.state === "grace") status = `<p class="warn">Your payment is overdue. Your website stays online for 14 days after the paid period ends, then it's paused. Paying brings it back instantly.</p>`;
    if (v.state === "paused") status = `<p class="warn">Your website is paused. Visitors see your business name and phone number only. Pay to bring it back instantly; nothing has been deleted.</p>`;
  }
  rows.push(`<dt>Offer credits</dt><dd>${b.credits} left</dd>`);

  const buttons: string[] = [];
  if (v.state === "unpublished" && v.source === "advault") {
    buttons.push(`<div class="buttons"><a class="btn" href="https://advault.3pandalabs.com/dashboard">Finish in AdVault</a></div>`);
  } else if (v.state === "unpublished") {
    buttons.push(publishButtons(slug, key, v.prices, siteUrl));
  } else {
    // Paying again only makes sense near the end of the paid time (or after it):
    // a site paid until next year must not be asked to pay now.
    const now = v.now ?? new Date();
    const covered = planCovers(b, now);
    const renewOpen =
      v.state === "grace" || v.state === "paused" || !v.paidUntil || v.paidUntil.getTime() - now.getTime() <= RENEW_WINDOW_DAYS * 86_400_000;
    const plans: string[] = [];
    if (!b.renewing && renewOpen && v.prices.basic !== null) {
      plans.push(payButton(slug, key, "renew_basic", `Basic: Pay $${v.prices.basic}/year`, true));
    }
    if (b.plan === "basic") {
      // Upgrading is always offered: Pro adds visitor stats.
      plans.push(payButton(slug, key, "renew_pro", `Upgrade to Pro: $${v.prices.pro}/year`));
    } else if (b.plan === "pro" && !b.renewing && renewOpen) {
      plans.push(payButton(slug, key, "renew_pro", `Pro: Pay $${v.prices.pro}/year`));
    }
    if (covered) plans.length = 0;
    if (plans.length) buttons.push(`<div class="buttons">${plans.join("")}</div>`);
    if (covered) buttons.push(`<p class="hint">Pro is included while your AdVault plan runs. Nothing to pay now.</p>`);
    if (!covered && !b.renewing && !renewOpen && v.paidUntil) {
      const price = b.plan === "pro" ? v.prices.pro : (v.prices.basic ?? v.prices.pro);
      buttons.push(
        `<p class="hint">${v.source === "advault" && b.plan === "pro" ? "Your first year of Pro is included with your AdVault website" : "Your plan is paid"} until ${esc(fmtDate(v.paidUntil))}. Nothing to pay now. Renewal ($${price} a year) opens ${RENEW_WINDOW_DAYS} days before then.</p>`,
      );
    }
  }
  const extra = [
    payButton(slug, key, "credits", `Buy ${PACK_CREDITS} offer credits for $${DOLLARS.pack}`, true),
    b.customerId
      ? `<form method="post" action="/api/billing/portal"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="slug" value="${esc(slug)}"><button class="btn ghost" type="submit">Manage billing</button></form>`
      : "",
  ].join("");

  // One-line teaser shown on the collapsed header. Keep anything the owner must
  // act on (not published, overdue, paused) visible, and open the section for it.
  const planWord = b.earlyAccess && !b.subscriptionId ? "Early access (free)" : b.plan === "pro" ? "Pro" : "Basic";
  let teaser: string;
  if (v.state === "unpublished") teaser = v.source === "advault" ? "Finish in AdVault to publish" : "Not published yet";
  else if (v.state === "paused") teaser = "Paused — pay to restore";
  else if (v.state === "grace") teaser = "Payment overdue";
  else teaser = [planWord, v.paidUntil ? `${b.renewing ? "renews" : "paid until"} ${fmtDate(v.paidUntil)}` : ""].filter(Boolean).join(", ");
  const open = v.state !== "live" || v.justPaid ? " open" : "";

  return `<details class="section" id="billing"${open}>
  <summary>Plan &amp; billing <span class="sum">— ${esc(teaser)}</span></summary>
  <div class="section-body">
  ${v.justPaid ? `<p class="notice ok" role="status">Thanks, your payment went through. It can take a minute to show here.</p>` : ""}
  ${status}
  <dl class="facts">${rows.join("")}</dl>
  ${buttons.join("")}
  <p class="hint">Changing your current special uses 1 credit. Clearing it is free. Upgrading from Basic to Pro starts a new yearly Pro plan; the unused part of Basic is credited to your next payment. Payments are handled by Stripe.</p>
  <div class="buttons">${extra}</div>
  </div>
</details>`;
}

const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  google: "Google",
  facebook: "Facebook",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  advault: "AdVault ads",
  direct: "Direct or typed in",
  other: "Other websites",
};

function barTable(caption: string, head: string, rows: { label: string; n: number }[]): string {
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.n), 1);
  return `<table class="bars"><caption>${esc(caption)}</caption><thead><tr><th scope="col">${esc(head)}</th><th scope="col"><span class="hint">Share</span></th><th scope="col" class="n">Visits</th></tr></thead><tbody>${rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}</th><td aria-hidden="true"><span class="bar" style="width:${Math.round((r.n / max) * 100)}%"></span></td><td class="n">${r.n}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

/** Edit-page moderation: pending customer reviews to approve/reject, approved ones to remove. */
export function reviewsModerationSection(slug: string, key: string, pending: Review[], approved: Review[], embed = false): string {
  const starStr = (n: number) => `${"★".repeat(n)}${"☆".repeat(5 - n)}`;
  const act = (action: string, id: string, label: string, cls = "btn ghost") =>
    `<form method="post" action="/api/sites/${encodeURIComponent(slug)}/reviews" style="display:inline">
      <input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="action" value="${action}"><input type="hidden" name="reviewId" value="${esc(id)}">${embed ? `<input type="hidden" name="embed" value="1">` : ""}
      <button class="${cls}" type="submit">${label}</button>
    </form>`;
  const card = (r: Review, buttons: string) =>
    `<div class="notice" style="margin:10px 0"><p style="margin:0 0 6px"><span style="color:#f59e0b;letter-spacing:1px">${starStr(r.rating)}</span> <strong>${esc(r.name)}</strong></p><p class="hint" style="margin:0 0 12px">${esc(r.text)}</p><div class="buttons">${buttons}</div></div>`;
  return `<section class="narrow" id="reviews" style="margin-top:32px">
<h2>Customer reviews</h2>
<p class="hint">Visitors can leave a review on your website; it only appears after you approve it.</p>
${
    pending.length
      ? `<h3 style="margin:18px 0 8px">Waiting for approval (${pending.length})</h3>
${pending.map((r) => card(r, `${act("approve", r.id, "Approve", "btn")} ${act("reject", r.id, "Reject")}`)).join("\n")}`
      : `<p class="hint" style="margin-top:14px">No reviews waiting for approval.</p>`
  }
${approved.length ? `<h3 style="margin:24px 0 8px">Published (${approved.length})</h3>\n${approved.map((r) => card(r, act("remove", r.id, "Remove"))).join("\n")}` : ""}
</section>`;
}

/**
 * The visitor stats. Edit page: a collapsed section. `open` (the owner's My
 * website page, 2026-11-20): the same content, shown open under a heading.
 */
export function visitorsSection(v: VisitorsView, embed = false, open = false, collapse?: { id: string; closeHref: string }): string {
  const s = v.stats;
  if (!s) return "";
  const wrap = (summary: string, body: string) =>
    collapse
      ? // CSS `:target` collapsible: hidden until its "Visitors stats" button (href="#id")
        // reveals it; the Hide link points back at the card, clearing :target. No JS needed.
        `<div class="vstats" id="${collapse.id}"><div class="vstats-head"><h3 style="margin:0;font-size:1rem">Visitors stats (last 30 days)</h3><a class="vstats-close" href="${collapse.closeHref}" aria-label="Hide visitors stats">Hide ✕</a></div><div class="vstats-body">${body}</div></div>`
      : open
        ? `<section class="visitors" aria-labelledby="visitors-h" style="padding:8px 0 4px"><h3 id="visitors-h" style="margin:0 0 6px;font-size:1rem">Visitors stats (last 30 days)</h3>${body}</section>`
        : `<details class="section"><summary>Visitors <span class="sum">— ${summary}</span></summary><div class="section-body">${body}</div></details>`;
  const total = `<p><strong>${s.total}</strong> visit${s.total === 1 ? "" : "s"} in the last 30 days.</p>`;
  const vt = `${s.total} visit${s.total === 1 ? "" : "s"} in the last 30 days`;
  if (!v.full) {
    return wrap(vt, `${total}${embed ? "" : `<p>Upgrade to Pro to see where visitors come from, which days are busiest, and how many tap to call.</p>`}`);
  }
  const place = (p: { city: string; country: string }) => [p.city, p.country].filter(Boolean).join(", ") || "Unknown";
  const tables = [
    barTable("Where visitors came from", "Source", s.sources.map((r) => ({ label: SOURCE_LABELS[r.source] ?? r.source, n: Number(r.views) }))),
    barTable("Where visitors are", "Place", s.places.map((r) => ({ label: place(r), n: Number(r.views) }))),
    barTable("Devices", "Device", s.devices.map((r) => ({ label: r.device.charAt(0).toUpperCase() + r.device.slice(1), n: Number(r.views) }))),
    barTable("Visits by day", "Day", s.days.map((r) => ({ label: fmtDate(new Date(`${r.day}T00:00:00Z`)), n: Number(r.views) }))),
  ].filter(Boolean);
  return wrap(vt, `${total}
  <dl class="facts"><dt>Taps to call</dt><dd>${s.taps.calls}</dd><dt>Taps for directions</dt><dd>${s.taps.directions}</dd></dl>
  ${tables.length ? `<div class="stats">${tables.join("")}</div>` : ""}
  <p class="hint">Counted without cookies and without storing anyone's IP address. Taps are counted by browsers that support it, so the real number can be higher.</p>`);
}

/** The owner's edit page tabs (2026-11-20). Hash ids: #edit, #view, #stats. */
export const OWNER_TABS = [
  { id: "edit", label: "Edit your website" },
  { id: "view", label: "View your website" },
  { id: "stats", label: "Stats" },
] as const;

/**
 * Opens the tabbed edit page: the heading, the tablist (links to the panels,
 * so without JS they jump to the stacked sections) and the Edit panel.
 */
function ownerTabsHead(): string {
  const tabs = OWNER_TABS.map(
    (t, i) => `<a class="otab" role="tab" id="tab-${t.id}" href="#${t.id}" aria-controls="${t.id}" aria-selected="${i === 0}">${esc(t.label)}</a>`,
  ).join("");
  return `<h1>Your website</h1>
<div class="otabs" role="tablist" aria-label="Your website">${tabs}</div>
<div class="opanels" id="owner-panels">
<div class="opanel" role="tabpanel" id="edit" aria-labelledby="tab-edit">`;
}

/**
 * Closes the Edit panel and adds "View your website" (an iframe of the saved
 * site through GET /edit/<slug>/view, same origin; "Refresh preview" posts
 * the form as it is to /preview into the same frame) and "Stats".
 */
function ownerTabsTail(mode: FormMode & { kind: "edit" }): string {
  const slug = encodeURIComponent(mode.site.slug);
  const viewUrl = `/edit/${slug}/view${mode.key ? `?k=${encodeURIComponent(mode.key)}` : ""}`;
  const published = !mode.billing || (mode.billing.state !== "unpublished" && mode.billing.state !== "paused");
  const status = published
    ? `Your website as it is saved${mode.siteUrl ? `, live at <a href="${esc(mode.siteUrl)}" target="_blank" rel="noopener">${esc(mode.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : ""}.`
    : mode.billing?.state === "paused"
      ? "Your website is paused. This is how it looks."
      : "Not published yet. This is how your website will look.";
  return `</div>
<div class="opanel" role="tabpanel" id="view" aria-labelledby="tab-view">
<h2 class="sr">View your website</h2>
<div class="viewbar">
  <p class="hint" id="view-status" style="margin:0">${status}</p>
  <div class="buttons">
    <button class="btn ghost" type="submit" form="builder" id="refresh-preview" data-preview formaction="/preview?site=${slug}" formtarget="sv-view" formnovalidate>Refresh preview</button>
    <a class="btn ghost" id="view-saved" href="${esc(viewUrl)}" target="sv-view">Show saved version</a>
    ${published && mode.siteUrl ? `<a class="btn ghost" href="${esc(mode.siteUrl)}" target="_blank" rel="noopener">Open in a new tab ↗</a>` : ""}
  </div>
  <p class="hint" style="margin:0">Refresh preview shows your changes before you save them. Nothing goes live until you press <strong>Save changes</strong>.</p>
</div>
<iframe class="sv-frame" name="sv-view" id="sv-view" title="Your website" src="${esc(viewUrl)}" loading="lazy"></iframe>
</div>
<div class="opanel" role="tabpanel" id="stats" aria-labelledby="tab-stats">
<h2>Visitors (last 30 days)</h2>
${statsPanel(mode.visitors)}
</div>
</div>`;
}

const fmtShortDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The Stats tab. Basic: the 30-day count and the upgrade note (no charts).
 * Pro (or billing off): every breakdown as a card with Bars | Pie | Table
 * (visits by day: Line | Bars | Table), charts as server-side SVG (charts.ts).
 */
export function statsPanel(v: VisitorsView | undefined): string {
  const s = v?.stats;
  if (!v || !s) return `<p class="hint">Visitor numbers aren't available right now. Please check back later.</p>`;
  const total = `<p><strong>${s.total}</strong> visit${s.total === 1 ? "" : "s"} in the last 30 days.</p>`;
  if (!v.full) return `${total}<p>Upgrade to Pro to see where visitors come from, which days are busiest, and how many tap to call.</p>`;
  const place = (p: { city: string; country: string }) => [p.city, p.country].filter(Boolean).join(", ") || "Unknown";
  const rows = (list: { label: string; n: number }[]): Row[] => list.map((r) => ({ label: r.label, n: Number(r.n) }));
  const taps: Row[] = [
    { label: "Taps to call", n: Number(s.taps.calls) },
    { label: "Taps for directions", n: Number(s.taps.directions) },
    ...(s.taps.offer ? [{ label: "Taps on the offer", n: Number(s.taps.offer) }] : []),
  ];
  const cards = [
    chartCard("st-sources", "Where visitors came from", "Source", rows(s.sources.map((r) => ({ label: SOURCE_LABELS[r.source] ?? r.source, n: r.views }))), "category"),
    chartCard("st-places", "Where visitors are", "Place", rows(s.places.map((r) => ({ label: place(r), n: r.views }))), "category"),
    chartCard("st-devices", "Devices", "Device", rows(s.devices.map((r) => ({ label: r.device.charAt(0).toUpperCase() + r.device.slice(1), n: r.views }))), "category"),
    chartCard("st-days", "Visits by day", "Day", rows(s.days.map((r) => ({ label: fmtShortDate(r.day), n: r.views }))), "time"),
    chartCard("st-taps", "Taps", "Tap", taps, "category"),
  ];
  return `${total}
<div class="tiles" style="margin:0 0 16px"><div class="tile"><div class="tile-n">${s.taps.calls}</div><div class="tile-l">Taps to call</div></div><div class="tile"><div class="tile-n">${s.taps.directions}</div><div class="tile-l">Taps for directions</div></div></div>
<div class="statgrid">${cards.join("")}</div>
<p class="hint">Counted without cookies and without storing anyone's IP address. Taps are counted by browsers that support it, so the real number can be higher.</p>`;
}

/**
 * The tabbed edit page: tabs without reloading (role=tab, aria-selected,
 * roving tabindex, Left/Right/Home/End), the tab in the URL hash (#edit,
 * #view, #stats; any other id, e.g. #reviews or #website-style, opens the tab
 * that holds it), and each stats card's Bars | Pie | Table toggle. Without
 * JS nothing is hidden: the panels stack and the tabs are jump links.
 */
const OWNER_TABS_SCRIPT = `
(function(){
  var box=document.getElementById('owner-panels'); if(!box) return;
  var tabs=[].slice.call(document.querySelectorAll('.otabs [role=tab]'));
  var ids=tabs.map(function(t){ return t.getAttribute('aria-controls'); });
  function show(id){
    if(ids.indexOf(id)<0) id='edit';
    box.setAttribute('data-tab',id);
    tabs.forEach(function(t){ var on=t.getAttribute('aria-controls')===id; t.setAttribute('aria-selected',on?'true':'false'); t.tabIndex=on?0:-1; });
  }
  function fromHash(){
    var h=''; try{ h=decodeURIComponent((location.hash||'').slice(1)); }catch(_){}
    if(!h){ show('edit'); return; }
    if(ids.indexOf(h)>=0){ show(h); return; }
    var el=document.getElementById(h), p=el&&el.closest?el.closest('[role=tabpanel]'):null;
    show(p?p.id:'edit'); if(el&&p) setTimeout(function(){ el.scrollIntoView({block:'start'}); },0);
  }
  tabs.forEach(function(t,i){
    t.addEventListener('click',function(ev){ ev.preventDefault(); var id=t.getAttribute('aria-controls'); show(id); try{ history.replaceState(null,'','#'+id); }catch(_){ location.hash=id; } });
    t.addEventListener('keydown',function(ev){
      var j=ev.key==='ArrowRight'?i+1:ev.key==='ArrowLeft'?i-1:ev.key==='Home'?0:ev.key==='End'?tabs.length-1:null;
      if(j===null) return; ev.preventDefault(); j=(j+tabs.length)%tabs.length; tabs[j].click(); tabs[j].focus();
    });
  });
  window.addEventListener('hashchange',fromHash);
  fromHash();
  // "Refresh preview" on a phone: switch to the View tab so the result is seen.
  var rp=document.getElementById('refresh-preview');
  if(rp) rp.addEventListener('click',function(){ if(box.getAttribute('data-tab')==='edit'&&!(window.matchMedia&&window.matchMedia('(min-width:1024px)').matches)) show('view'); });
  // Stats: Bars | Pie | Table (Line | Bars | Table for days). Every view is in the page; this only switches.
  [].forEach.call(document.querySelectorAll('[data-chart]'),function(card){
    var group=card.querySelector('.viewtoggle'); if(!group) return; group.hidden=false;
    var btns=[].slice.call(group.querySelectorAll('button[data-view]')), views=[].slice.call(card.querySelectorAll('.view[data-view]'));
    btns.forEach(function(b){ b.addEventListener('click',function(){
      var v=b.getAttribute('data-view');
      btns.forEach(function(x){ x.setAttribute('aria-pressed',x===b?'true':'false'); });
      views.forEach(function(x){ x.hidden=x.getAttribute('data-view')!==v; });
    }); });
  });
})();`;

const FIELD_ORDER = [
  "businessName",
  "slug",
  "category",
  "phone",
  "email",
  "city",
  "address",
  "serviceArea",
  "locations",
  "tagline",
  "offer",
  "services",
  "hours",
  "about",
  "photos",
  "video",
  "beforeAfter",
  "baAttest",
  "acct_email",
  "acct_password",
  "attest",
] as const;

export const ADVAULT_ORIGIN = "https://advault.3pandalabs.com";

/**
 * Below the offer on the owner's edit page (never on the customer site): the
 * same offer as an AdVault video ad. AdVault-made sites have an AdVault
 * account, so they deep-link to the combo; everyone else gets AdVault's home.
 */
export function advaultOfferLink(site: Pick<Site, "slug" | "source">, embed = false): string {
  // Embedded in AdVault: open AdVault in the whole tab, not inside the frame.
  const style = ` style="display:inline-block;padding:12px 0;min-height:44px"${embed ? ' target="_top"' : ""}`;
  return site.source === "advault"
    ? `<a${style} href="${esc(`${ADVAULT_ORIGIN}/dashboard?siteOffer=${encodeURIComponent(site.slug)}`)}">Also run this offer as a YouTube ad with AdVault →</a>`
    : `<a${style} href="${esc(ADVAULT_ORIGIN)}">Turn this offer into a video ad</a>`;
}

/**
 * The edit page's "Before & after" fieldset: untick a pair to remove it, and
 * (only for trades where before & after fits) add pairs up to the limit, with
 * the "real photos of our own work" tick. Empty when there's nothing to show.
 */
export function beforeAfterFields(site: Site, photoUrl: (k: string) => string, e: (k: string) => string): string {
  const pairs = site.beforeAfter ?? [];
  const canAdd = beforeAfterAllowed(site.category);
  if (!pairs.length && !canAdd) return "";
  const current = pairs.length
    ? `<p class="hint">Current pairs. Untick a pair to remove it from your website.</p>
<div class="photos">${pairs
        .map(
          (p, i) =>
            `<div class="photo"><div class="ba-thumbs"><img src="${esc(photoUrl(p.before))}" alt="Before, pair ${i + 1}"><img src="${esc(photoUrl(p.after))}" alt="After, pair ${i + 1}"></div><div class="photo-ctl"><label class="pkeep"><input type="checkbox" name="keepPair" value="${esc(p.before)}" checked> Keep pair ${i + 1}</label></div></div>`,
        )
        .join("")}</div>`
    : "";
  const free = canAdd ? Math.max(0, MAX_BEFORE_AFTER - pairs.length) : 0;
  const slots = BEFORE_AFTER_FIELDS.slice(0, free)
    .map(
      ([b, a], i) =>
        `<div class="row">
    <div class="field"><label for="${b}">New pair ${i + 1}: before photo</label><input type="file" id="${b}" name="${b}" accept="image/*"></div>
    <div class="field"><label for="${a}">New pair ${i + 1}: after photo</label><input type="file" id="${a}" name="${a}" accept="image/*"></div>
  </div>`,
    )
    .join("\n  ");
  const add = free
    ? `<p class="hint">Optional. Up to ${MAX_BEFORE_AFTER} pairs, each a before and an after photo of the same job. Shown in a "Before &amp; after" section.</p>
  ${slots}
  <div class="field"><label class="check"><input type="checkbox" name="baAttest" value="yes"> <span>These are real photos of our own work.</span></label>${e("baAttest")}</div>`
    : "";
  return `<fieldset><legend>Before &amp; after</legend>
  ${current}
  ${add}
  ${e("beforeAfter")}
</fieldset>`;
}

/**
 * The "Menu" section for restaurants & bakeries: upload a PDF or a photo of the
 * menu (up to MAX_MENU), with keep-boxes for existing files (edit page). Shown
 * on both the builder and the edit page, but only for food categories — it
 * starts hidden and the builder script reveals it when the owner picks a food
 * category (`data-menu-cats`); server-side it's visible when the category is
 * already food (e.g. a validation re-render, or the edit page).
 */
/** One current-menu-file card (edit page): a thumbnail/PDF tile + a keep box. */
export function menuCard(url: string, key: string, index: number, pdf: boolean): string {
  const n = index + 1;
  return pdf
    ? `<div class="photo"><div class="menu-doc">PDF menu ${n}</div><div class="photo-ctl"><label class="pkeep"><input type="checkbox" name="keepMenu" value="${esc(key)}" checked> Keep</label><a class="tpl-preview" href="${esc(url)}" target="_blank" rel="noopener">View ↗</a></div></div>`
    : `<div class="photo"><img src="${esc(url)}" alt="Menu ${n}"><div class="photo-ctl"><label class="pkeep"><input type="checkbox" name="keepMenu" value="${esc(key)}" checked> Keep menu ${n}</label></div></div>`;
}

function menuFields(category: string, files: string[], photoUrl: ((k: string) => string) | null, e: (k: string) => string): string {
  const isEdit = photoUrl !== null;
  const cards = files.map((k, i) => menuCard(photoUrl!(k), k, i, isMenuPdf(k))).join("");
  // On the edit page the current list is a live region the Upload button updates.
  const current = isEdit
    ? `<p class="hint" id="menu-current-h"${files.length ? "" : " hidden"}>Current menu files. Untick to remove one when you save.</p>
<div class="photos" id="menu-current">${cards}</div>`
    : "";
  const uploadBtn = isEdit
    ? `<div class="menu-upload"><button type="button" class="btn ghost" id="menu-upload-btn">Upload menu</button> <span class="hint" id="menu-status" role="status" aria-live="polite"></span></div>`
    : "";
  const add = `<div class="field"><label for="menu">Add menu files <span class="hint">Up to ${MAX_MENU} in total. A PDF or a clear photo (JPG, PNG, WebP), up to 10 MB each. Each appears as a thumbnail on your site — visitors tap a photo to enlarge it, or a PDF to open it.</span></label><input type="file" id="menu" name="menu" accept="image/*,application/pdf" multiple>${uploadBtn}${e("menu")}</div>`;
  return `<fieldset id="menu-fieldset" data-show-cats="${esc(MENU_CATEGORIES.join(","))}"${menuAllowed(category) ? "" : " hidden"}><legend>Menu</legend>
  <p class="hint">Show your menu on your website — upload a PDF or a clear photo of it.${isEdit ? ` Choose a file, then click <strong>Upload menu</strong> to add it right away.` : ""}</p>
  ${current}
  ${add}
</fieldset>`;
}

/**
 * The "Class schedule" section for fitness businesses: one uploaded timetable
 * (image or PDF). On the edit page the current one shows with a keep box; a new
 * upload replaces it. Category-gated like the Menu via data-show-cats.
 */
function scheduleFields(category: string, current: string | null, photoUrl: ((k: string) => string) | null, e: (k: string) => string): string {
  const cur =
    current && photoUrl
      ? `<label class="check"><input type="checkbox" name="keepSchedule" value="yes" checked> <span>Keep the current schedule on my website</span></label>
<div class="photos">${
          isMenuPdf(current)
            ? `<div class="photo"><div class="menu-doc">PDF schedule</div><div class="photo-ctl"><a class="tpl-preview" href="${esc(photoUrl(current))}" target="_blank" rel="noopener">View ↗</a></div></div>`
            : `<div class="photo"><img src="${esc(photoUrl(current))}" alt="Class schedule"></div>`
        }</div>`
      : "";
  const label = current ? "Replace schedule" : "Add a schedule";
  return `<fieldset id="schedule-fieldset" data-show-cats="${esc(SCHEDULE_CATEGORIES.join(","))}"${scheduleAllowed(category) ? "" : " hidden"}><legend>Class schedule</legend>
  <p class="hint">Upload your weekly class schedule as a clear photo or a PDF — it shows on your website, and visitors tap it to enlarge.</p>
  ${cur}
  <div class="field"><label for="schedule">${label} <span class="hint">One PDF or image, up to 10 MB.</span></label><input type="file" id="schedule" name="schedule" accept="image/*,application/pdf">${e("schedule")}</div>
</fieldset>`;
}

/**
 * The "Insurance accepted" section for dentists & clinics: the plans they take,
 * one per line. Category-gated like the others via data-show-cats.
 */
function insuranceFields(category: string, value: string, e: (k: string) => string): string {
  return `<fieldset id="insurance-fieldset" data-show-cats="${esc(INSURANCE_CATEGORIES.join(","))}"${insuranceAllowed(category) ? "" : " hidden"}><legend>Insurance accepted</legend>
  <p class="hint">List the insurance plans you accept, one per line, so patients know before they call.</p>
  <div class="field"><label for="insurance">Insurance plans <span class="hint">Optional. One per line.</span></label><textarea id="insurance" name="insurance" placeholder="Delta Dental&#10;Cigna&#10;Aetna&#10;MetLife&#10;UnitedHealthcare">${value}</textarea>${e("insurance")}</div>
</fieldset>`;
}

/**
 * The "Meet the team" section for people-facing businesses: members one per
 * line as "Name | Role". Category-gated via data-show-cats.
 */
function teamFields(category: string, value: string, e: (k: string) => string): string {
  return `<fieldset id="team-fieldset" data-show-cats="${esc(TEAM_CATEGORIES.join(","))}"${teamAllowed(category) ? "" : " hidden"}><legend>Meet the team</legend>
  <p class="hint">Introduce the people behind your business. One per line as <strong>Name | Role</strong> (the role is optional), up to ${MAX_TEAM}.</p>
  <div class="field"><label for="team">Team members <span class="hint">Optional.</span></label><textarea id="team" name="team" placeholder="Maria Lopez | Owner & senior stylist&#10;James Carter | Barber&#10;Priya Shah | Colour specialist">${value}</textarea>${e("team")}</div>
</fieldset>`;
}

/**
 * The "Featured listings" section for real estate: existing listings show with
 * a keep box; new ones use photo + price + status + details slots (a photo
 * makes a listing). Category-gated via data-show-cats.
 */
function listingsFields(category: string, listings: Listing[], photoUrl: ((k: string) => string) | null, e: (k: string) => string): string {
  const current =
    listings.length && photoUrl
      ? `<p class="hint">Current listings. Untick to remove one when you save.</p>
<div class="photos">${listings
          .map(
            (l, i) =>
              `<div class="photo"><img src="${esc(photoUrl(l.photo))}" alt="Listing ${i + 1}"><div class="photo-ctl"><label class="pkeep"><input type="checkbox" name="keepListing" value="${esc(l.photo)}" checked> ${esc(l.status)}${l.price ? ` · ${esc(l.price)}` : ""}</label></div></div>`,
          )
          .join("")}</div>`
      : "";
  const free = Math.min(Math.max(0, MAX_LISTINGS - listings.length), 3);
  const statusOpts = LISTING_STATUSES.map((s, i) => `<option value="${esc(s)}"${i === 0 ? " selected" : ""}>${esc(s)}</option>`).join("");
  const slots = LISTING_SLOTS.slice(0, free)
    .map(
      (s, i) => `<div class="listing-slot"><p class="hint" style="font-weight:600;margin:12px 0 6px">New listing ${i + 1}</p>
  <div class="field"><label for="${s.photo}">Photo</label><input type="file" id="${s.photo}" name="${s.photo}" accept="image/*"></div>
  <div class="row">
    <div class="field"><label for="${s.price}">Price <span class="hint">Optional</span></label><input type="text" id="${s.price}" name="${s.price}" maxlength="24" placeholder="$450,000"></div>
    <div class="field"><label for="${s.status}">Status</label><select id="${s.status}" name="${s.status}">${statusOpts}</select></div>
  </div>
  <div class="field"><label for="${s.details}">Details <span class="hint">Optional</span></label><input type="text" id="${s.details}" name="${s.details}" maxlength="120" placeholder="3 bed · 2 bath · 1,800 sqft"></div>
</div>`,
    )
    .join("\n  ");
  const add = free ? `<p class="hint">Add a property — the photo makes the listing; price and details are optional.</p>\n  ${slots}` : "";
  return `<fieldset id="listings-fieldset" data-show-cats="${esc(LISTING_CATEGORIES.join(","))}"${listingsAllowed(category) ? "" : " hidden"}><legend>Featured listings</legend>
  <p class="hint">Show a few properties on your website. Enter only facts, and follow US fair-housing law — no preferences based on protected characteristics.</p>
  ${current}
  ${add}
  ${e("listings")}
</fieldset>`;
}

/** The "Questions & answers" section — shown for every category (not gated). */
function faqFields(value: string, e: (k: string) => string): string {
  return `<fieldset><legend>Questions &amp; answers</legend>
  <p class="hint">Answer the things customers ask most. One per line as <strong>Question | Answer</strong>, up to ${MAX_FAQ}. They show as a tap-to-open list on your site.</p>
  <div class="field"><label for="faq">FAQs <span class="hint">Optional.</span></label><textarea id="faq" name="faq" placeholder="Do you take walk-ins? | Yes, but appointments are recommended on weekends.&#10;Where do you park? | Free lot behind the building.">${value}</textarea>${e("faq")}</div>
</fieldset>`;
}

export function builderPage(
  mode: FormMode,
  nonce: string,
  errors: FieldErrors = {},
  values: Record<string, string> = {},
  domain: string | null = null,
): string {
  const site = mode.kind === "edit" ? mode.site : null;
  // Inside AdVault's "Your website": no SiteVault chrome, billing or upsell
  // (AdVault covers AdVault-made sites), and saves come back here.
  const embed = (mode.kind === "edit" && Boolean(mode.embed)) || (mode.kind === "new" && Boolean(mode.embedDraft));
  const draft = mode.kind === "new" ? mode.embedDraft : undefined;
  const v = (k: string, fallback = "") => esc(values[k] ?? fallback);
  const e = (k: string) => `<div class="err" id="err-${k}" role="alert">${esc(errors[k] ?? "")}</div>`;
  // One-tap suggestion chips, from what the form already knows (name, type, town).
  const sctx: SuggestContext = {
    businessName: values.businessName ?? site?.businessName ?? "",
    category: values.category ?? site?.category ?? "",
    city: values.city ?? site?.city ?? "",
    address: values.address ?? site?.address ?? "",
    serviceArea: values.serviceArea ?? site?.serviceArea ?? "",
  };
  const sg = (f: Parameters<typeof suggestChips>[0]) => suggestChips(f, sctx);
  const action = mode.kind === "edit" ? `/api/sites/${encodeURIComponent(mode.site.slug)}` : draft ? "/api/embed/sites" : "/api/sites";
  const selectedCat = values.category ?? site?.category ?? "";
  const renamesLeft = site ? Math.max(0, MAX_RENAMES - (site.renames ?? 0)) : MAX_RENAMES;
  const addressField = domain
    ? `<div class="field"><label for="slug">Your web address <span class="hint">${
        site
          ? renamesLeft > 0
            ? `You can change it ${renamesLeft} more time${renamesLeft === 1 ? "" : "s"}. Your old address keeps working and sends visitors here.`
            : "This address can't be changed again."
          : "Filled in from your business name. Change it if you like."
      }</span></label>
  <div class="addr"><span>https://</span><input type="text" id="slug" name="slug" maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false" value="${v("slug", site?.slug ?? "")}" data-original="${esc(site?.slug ?? "")}" data-domain="${esc(domain)}"${site && renamesLeft === 0 ? " readonly" : ""}><span>.${esc(domain)}</span></div>
  <div class="hint" id="slug-status" aria-live="polite"></div>${e("slug")}</div>`
    : "";

  const existing =
    mode.kind === "edit" && mode.site.photos.length
      ? `<p class="hint">Current photos. The first is the big one at the top — drag them, or use the arrows, to reorder; untick to remove.</p>
<div class="photos" id="photolist">${mode.site.photos
          .map(
            (k, i) =>
              `<div class="photo" draggable="true"><img src="${esc(mode.photoUrl(k))}" alt="Photo ${i + 1}"><input type="hidden" name="keep" value="${esc(k)}"><div class="photo-ctl"><button type="button" class="pmove" data-dir="up" aria-label="Move earlier">&#8593;</button><button type="button" class="pmove" data-dir="down" aria-label="Move later">&#8595;</button><button type="button" class="premove" aria-label="Remove this photo">&#10005; Remove</button></div></div>`,
          )
          .join("")}</div>`
      : draft && draft.photos.length
        ? `<p class="hint">Photos from your ad. The first is the big one at the top — drag them, or use the arrows, to reorder; remove any you don't want.</p>
<div class="photos" id="photolist">${draft.photos
            .map(
              (p, i) =>
                `<div class="photo" draggable="true"><img src="${esc(p.url)}" alt="Photo ${i + 1}"><input type="hidden" name="keepDraft" value="${esc(p.key)}"><div class="photo-ctl"><button type="button" class="pmove" data-dir="up" aria-label="Move earlier">&#8593;</button><button type="button" class="pmove" data-dir="down" aria-label="Move later">&#8595;</button><button type="button" class="premove" aria-label="Remove this photo">&#10005; Remove</button></div></div>`,
            )
            .join("")}</div>`
        : "";

  const beforeAfter =
    mode.kind === "edit"
      ? beforeAfterFields(mode.site, mode.photoUrl, e)
      : draft && draft.pairs.length
        ? `<fieldset><legend>Before &amp; after</legend>
  <p class="hint">From your ad: real photos of your own work. Untick a pair to leave it off your website.</p>
  ${draft.pairs
    .map(
      (p, i) =>
        `<div class="field"><label class="check"><input type="checkbox" name="keepDraftPair" value="${i}" checked> <span>Show pair ${i + 1}</span></label><div class="photos"><div class="photo"><img src="${esc(p.before)}" alt="Before, pair ${i + 1}"></div><div class="photo"><img src="${esc(p.after)}" alt="After, pair ${i + 1}"></div></div></div>`,
    )
    .join("")}
  ${e("beforeAfter")}
</fieldset>`
        : "";
  const menu = menuFields(selectedCat, mode.kind === "edit" ? mode.site.menu ?? [] : [], mode.kind === "edit" ? mode.photoUrl : null, e);
  const schedule = scheduleFields(selectedCat, mode.kind === "edit" ? mode.site.schedule ?? null : null, mode.kind === "edit" ? mode.photoUrl : null, e);
  const insurance = insuranceFields(selectedCat, v("insurance", site?.insurance ?? ""), e);
  const team = teamFields(selectedCat, v("team", site ? teamToText(site.team) : ""), e);
  const faq = faqFields(v("faq", site ? faqToText(site.faq) : ""), e);
  const listings = listingsFields(selectedCat, mode.kind === "edit" ? mode.site.listings ?? [] : [], mode.kind === "edit" ? mode.photoUrl : null, e);

  // The owner's edit page on SiteVault (not inside AdVault): three tabs, the
  // form beside a live view on wide screens (ownerTabsHead / ownerTabsTail).
  const tabbed = mode.kind === "edit" && !embed;
  const body = `<section${tabbed ? ' class="owner"' : ""}>
${tabbed ? ownerTabsHead() : ""}
${tabbed ? `<h2 class="sr">Edit your website</h2>` : `<h1>${mode.kind === "edit" ? "Edit your website" : "Build your website"}</h1>`}
${tabbed && mode.kind === "edit" && mode.saved ? `<p class="notice ok" role="status" id="owner-saved"><strong>Saved.</strong> Your changes are live.</p>` : ""}
${mode.kind === "edit" ? "" : `<p class="lead">${draft ? "We filled in what your ad already knows. Check it, add anything you like, then create your website. You can change all of it later." : "Takes about five minutes. Only the first three fields are required; everything else makes your site better."}</p>`}
${
  embed && mode.kind === "edit" && mode.saved
    ? `<div class="notice" id="embed-saved" role="status" data-slug="${esc(mode.site.slug)}" data-site-url="${esc(mode.siteUrl ?? "")}"><p style="margin:0"><strong>Saved.</strong> Your changes are live.${mode.siteUrl ? ` <a href="${esc(mode.siteUrl)}" target="_blank" rel="noopener">Open my website</a>` : ""}</p></div>`
    : ""
}
${previewBanner(mode)}
<form id="builder" method="post" action="${action}" enctype="multipart/form-data" novalidate${createConfirm(mode)}${tabbed ? " data-owner-tabs" : ""}>
${mode.kind === "edit" ? `<input type="hidden" name="key" value="${esc(mode.key)}">` : ""}
${embed && !draft ? `<input type="hidden" name="embed" value="1">` : ""}
${draft ? `<input type="hidden" name="draft" value="${esc(draft.id)}">` : ""}
<fieldset><legend>Your business</legend>
  <div class="field"><label for="businessName">Business name</label><input type="text" id="businessName" name="businessName" maxlength="80" required value="${v("businessName", site?.businessName)}" autocomplete="organization">${sg("businessName")}${e("businessName")}</div>
  ${addressField}
  <div class="row">
    <div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="phone" maxlength="24" required value="${v("phone", site?.phone)}" autocomplete="tel" placeholder="(201) 555-0100">${e("phone")}</div>
    <div class="field"><label for="city">Town or city <span class="hint">Needed unless you add a street address below.</span></label><input type="text" id="city" name="city" maxlength="60" value="${v("city", site?.city)}" placeholder="Secaucus, NJ">${sg("city")}${e("city")}</div>
  </div>
  <div class="row">
    <div class="field"><label for="category">Type of business</label><select id="category" name="category" required>
      <option value="">Choose one</option>
      ${Object.entries(CATEGORIES)
        .map(([k, c]) => `<option value="${k}"${selectedCat === k ? " selected" : ""}>${esc(c.label)}</option>`)
        .join("")}
    </select>${e("category")}</div>
    <div class="field"><label for="email">Email <span class="hint">Optional. Shown on your site.</span></label><input type="email" id="email" name="email" maxlength="120" value="${v("email", site?.email ?? "")}" autocomplete="email">${e("email")}</div>
  </div>
  <div class="row">
    <div class="field"><label for="address">Street address <span class="hint">Optional. Leave blank if you go to customers.</span></label><input type="text" id="address" name="address" maxlength="160" value="${v("address", site?.address ?? "")}" autocomplete="street-address">${e("address")}</div>
    <div class="field"><label for="serviceArea">Areas you serve <span class="hint">Optional</span></label><input type="text" id="serviceArea" name="serviceArea" maxlength="160" value="${v("serviceArea", site?.serviceArea ?? "")}" placeholder="Secaucus, Hoboken, Jersey City">${sg("serviceArea")}${e("serviceArea")}</div>
    <div class="field"><details${values.locations || site?.locations?.length ? " open" : ""}><summary style="cursor:pointer;font-weight:600">Add more locations <span class="hint">Optional — if your business has multiple branches</span></summary>
      <p class="hint" style="margin:10px 0 6px">One per line, as <strong>Name | Address | Phone</strong> (up to ${MAX_LOCATIONS}). Each gets its own Call and Directions in a "Locations" popup on your site.</p>
      <textarea id="locations" name="locations" aria-label="More locations, one per line: Name | Address | Phone" placeholder="Downtown | 123 Main St, Springfield | (555) 111-2222&#10;Westside | 456 Oak Ave, Springfield | (555) 333-4444">${v("locations", site ? locationsToText(site.locations ?? []) : "")}</textarea>${e("locations")}
    </details></div>
  </div>
</fieldset>
<fieldset><legend>What you offer</legend>
  <div class="field"><label for="tagline">One line about you <span class="hint">Optional. Shown under your name.</span></label><input type="text" id="tagline" name="tagline" maxlength="120" value="${v("tagline", site?.tagline)}" placeholder="Family-owned lawn care since 2009">${sg("tagline")}${e("tagline")}</div>
  <div class="field"><label for="offer">Current special <span class="hint">Optional. Shown in a banner.${
    mode.kind === "edit" && mode.billing
      ? ` Changing it uses 1 credit (${mode.billing.billing.credits} left). Clearing it is free.`
      : ""
  }</span></label><input type="text" id="offer" name="offer" maxlength="160" value="${v("offer", site?.offer ?? "")}" placeholder="Spring cleanup from $149, this month only">${sg("offer")}${e("offer")}${mode.kind === "edit" ? advaultOfferLink(mode.site, mode.embed) : ""}</div>
  <div class="field"><label for="services">Services and prices <span class="hint">Optional. One per line, price after a dash.</span></label><textarea id="services" name="services" placeholder="Lawn mowing - from $35&#10;Spring cleanup - $149&#10;Hedge trimming">${v("services", site ? servicesToText(site.services) : "")}</textarea>${sg("services")}${e("services")}</div>
  <div class="field"><label for="hours">Opening hours <span class="hint">Optional</span></label><textarea id="hours" name="hours" placeholder="Mon-Fri 8am-6pm&#10;Sat 9am-2pm&#10;Sun closed">${v("hours", site?.hours ?? "")}</textarea>${sg("hours")}${e("hours")}</div>
  <div class="field"><label for="about">About your business <span class="hint">Optional. A few sentences in your own words.</span></label><textarea id="about" name="about" maxlength="1200">${v("about", site?.about)}</textarea>${sg("about")}${e("about")}</div>
</fieldset>
<fieldset><legend>Photos &amp; video</legend>
  <label class="check"><input type="hidden" name="heroPhoto" value="no"><input type="checkbox" name="heroPhoto" value="yes"${mode.kind === "new" || mode.site.heroPhoto ? " checked" : ""}> <span>Use my first photo as the big banner at the top. Unticked, the top is a clean coloured banner and every photo goes in the gallery.</span></label>
  ${mode.kind === "edit" && mode.site.video ? `<label class="check"><input type="checkbox" name="keepVideo" value="yes" checked> <span>Keep the current video on my website</span></label>` : ""}
  ${draft?.video ? `<label class="check"><input type="checkbox" name="keepDraftVideo" value="yes" checked> <span>Show my video from AdVault on my website</span></label>` : ""}
  ${existing}
  <div class="field"><label for="photos">Add photos <span class="hint">Up to ${MAX_PHOTOS} in total. Straight from your phone is fine — we resize them. Use photos you took or have the right to use.</span></label><input type="file" id="photos" name="photos" accept="image/*" multiple>${e("photos")}</div>
  <div class="field"><label for="video">Add a video <span class="hint">Optional. One MP4, up to 40 MB${mode.kind === "edit" && mode.site.video ? " — uploading a new one replaces the current video" : ""}. Shown in a "See us in action" section.</span></label><input type="file" id="video" name="video" accept="video/mp4">${e("video")}</div>
</fieldset>
${beforeAfter}
${menu}
${schedule}
${team}
${insurance}
${listings}
${faq}
${mode.kind === "new" && !draft ? accountFields(mode.account ?? null, v, e) : ""}
${draft && mode.kind === "new" && mode.account ? `<p class="hint" style="margin:16px 0">${mode.account.email.includes("@") ? `Saved to your 3PandaLabs account, <strong>${esc(mode.account.email)}</strong> (the same login as AdVault).` : "Saved to this AdVault account."}</p>` : ""}
<fieldset id="website-style"><legend>Preview your website in different styles</legend>
  <p class="hint">Try each style to see your website with your details, then choose the one you like. You can switch anytime.</p>
  <div class="templates"${CAT_THUMB_COLORS[selectedCat] ? ` style="--tp:${CAT_THUMB_COLORS[selectedCat].p};--tb:${CAT_THUMB_COLORS[selectedCat].b}"` : ""}>
    ${(() => {
      const selTpl = values.template ?? site?.template ?? DEFAULT_TEMPLATE;
      const previewBase = mode.kind === "edit" ? mode.siteUrl : undefined;
      return TEMPLATES.map(
        (t) =>
          `<div class="tpl-item"><label class="tpl${selTpl === t.key ? " sel" : ""}"><input type="radio" name="template" value="${t.key}"${selTpl === t.key ? " checked" : ""}><span class="tpl-thumb tpl-${t.key}"></span><span class="tpl-name">${esc(t.label)}</span><span class="tpl-blurb">${esc(t.blurb)}</span></label>${previewBase ? `<a class="tpl-preview" href="${esc(previewBase)}?style=${t.key}" target="_blank" rel="noopener">Preview this style ↗</a>` : ""}</div>`,
      ).join("");
    })()}
  </div>
  ${(() => {
    const colorOn = values.customColor !== undefined ? values.customColor === "1" : Boolean(site?.brandColor);
    const colorVal = values.brandColor || site?.brandColor || CAT_THUMB_COLORS[selectedCat]?.p || "#1e3a8a";
    return `<div class="brandcolor">
    <label class="check"><input type="checkbox" name="customColor" value="1"${colorOn ? " checked" : ""}> <span>Use my own brand colour</span></label>
    <div class="bc-body"${colorOn ? "" : " hidden"}>
      <div class="bc-row">
        <input type="color" id="brandColor" name="brandColor" value="${esc(colorVal)}" aria-label="Brand colour">
        <div class="bc-swatches" role="group" aria-label="Suggested brand colours">${BRAND_PRESETS.map((h) => `<button type="button" class="bc-sw" data-c="${h}" style="background:${h}" aria-label="Use ${h}"></button>`).join("")}</div>
      </div>
      <p class="hint">Pick a colour or type your own. We deepen very light colours automatically so your text stays easy to read.</p>
    </div>
  </div>`;
  })()}
</fieldset>
<div class="field"><label class="check"><input type="checkbox" name="attest" value="yes" required${mode.kind === "edit" ? " checked" : ""}> <span>${
  draft
    ? `I run this business, the details are accurate, and I agree to the <a href="/terms" target="_blank" rel="noopener">SiteVault terms</a>. The website is public.`
    : `I own or run this business (or have its permission), the details are accurate, and I agree to the <a href="/terms" target="_blank">Terms</a>.`
}</span></label>${e("attest")}</div>
<div class="err" id="err-form" role="alert">${esc(errors.form ?? "")}</div>
<div class="buttons">
  <button class="btn" type="submit" id="submit">${mode.kind === "edit" ? "Save changes" : "Create my website"}</button>
  <button class="btn ghost" type="submit" id="preview-btn" data-preview formaction="${esc(previewAction(mode))}" formtarget="_blank" formnovalidate>Preview my website</button>
  ${mode.kind === "edit" ? `<a class="btn ghost" href="/edit/${encodeURIComponent(mode.site.slug)}${embed ? "?embed=1" : `?k=${encodeURIComponent(mode.key)}`}">Cancel</a>` : ""}
</div>
</form>
${mode.kind === "edit" && mode.visitors && !tabbed ? visitorsSection(mode.visitors, embed) : ""}
${mode.kind === "edit" && mode.billing && !embed ? billingSection(mode.site.slug, mode.key, mode.billing, mode.siteUrl ?? "") : ""}
${mode.kind === "edit" ? reviewsModerationSection(mode.site.slug, mode.key, mode.pendingReviews ?? [], mode.site.reviews ?? [], embed) : ""}
${
  mode.kind === "edit"
    ? `<div style="margin-top:28px" class="notice">
  <p><strong>Want your website taken down?</strong> Email <a href="mailto:sitevault@3pandalabs.com?subject=${encodeURIComponent(`Remove my website: ${mode.site.slug}`)}">sitevault@3pandalabs.com</a> with your web address. We'll confirm with you at the phone number on your site, cancel any renewal, and remove it.</p>
</div>`
    : ""
}
${tabbed && mode.kind === "edit" ? ownerTabsTail(mode) : ""}
</section>`;

  return layout({
    title: mode.kind === "edit" ? "Edit your website — SiteVault" : "Build your website — SiteVault",
    path: mode.kind === "new" ? "/new" : undefined,
    body,
    nonce,
    owner: mode.kind === "edit",
    admin: mode.admin,
    signedIn: mode.kind === "new" ? Boolean(mode.account) : Boolean(mode.signedIn),
    noindex: mode.kind === "edit" || Boolean(draft),
    embed,
    script: PUBLISH_CONFIRM_SCRIPT + SUGGEST_SCRIPT + BUILDER_SCRIPT + (embed ? EMBED_SCRIPT : "") + (tabbed ? OWNER_TABS_SCRIPT : ""),
  });
}

/**
 * The reassurance line above the form. An already-published site: changes
 * go live only on Save. Otherwise: they'll see it before it goes live.
 */
function previewBanner(mode: FormMode): string {
  const published = mode.kind === "edit" && (!mode.billing || mode.billing.state !== "unpublished");
  const text = published
    ? "Changes go live only when you press Save changes."
    : "Don't worry: you'll see a preview of your website with your details before it goes live. Press <strong>Preview my website</strong> at the bottom any time.";
  return `<p class="notice" id="preview-banner" style="margin:0 0 20px">${text}</p>`;
}

/**
 * "Preview my website" posts the form as it is to POST /preview in a new tab
 * (index.ts previewSite): rendered, nothing saved. The edit page names its
 * site so kept photos can be shown.
 */
function previewAction(mode: FormMode): string {
  return mode.kind === "edit" ? `/preview?site=${encodeURIComponent(mode.site.slug)}` : "/preview";
}

/**
 * The create form asks before it goes live (PUBLISH_CONFIRM_SCRIPT): "publish"
 * when the new site is live at once, "create" when it is made unpublished
 * (it is then published by a pay button, which asks too). Saving edits to a
 * live site never asks.
 */
function createConfirm(mode: FormMode): string {
  if (mode.kind !== "new") return "";
  return ` data-confirm-publish="${mode.publishesNow ? "publish" : "create"}"`;
}

/**
 * Before a form that publishes is sent: an in-page "Publish now?" panel (never
 * window.confirm). Only "Yes, publish" sends the form; "Go back" closes the
 * panel. Registered BEFORE the builder's own submit handler, and it stops the
 * event, so the builder's fetch runs only after the yes. The address comes
 * from the form's web-address field, else data-confirm-addr. Without JS the
 * form posts as before (no confirm): the no-JS path is unchanged.
 */
const PUBLISH_CONFIRM_SCRIPT = `
(function(){
  [].slice.call(document.querySelectorAll('form[data-confirm-publish]')).forEach(function(f){
    var panel=null, previewing=false;
    // "Preview my website" (formaction /preview) never publishes: no confirm.
    var pv=f.querySelector('#preview-btn'); if(pv) pv.addEventListener('click',function(){ previewing=true; setTimeout(function(){ previewing=false; },0); });
    function addr(){
      var slug=f.querySelector('#slug');
      if(slug&&slug.value&&slug.getAttribute('data-domain')) return 'https://'+slug.value.trim().toLowerCase()+'.'+slug.getAttribute('data-domain');
      return f.getAttribute('data-confirm-addr')||'your web address';
    }
    function close(){ if(panel){ panel.parentNode.removeChild(panel); panel=null; } }
    f.addEventListener('submit',function(ev){
      if(previewing||(ev.submitter&&ev.submitter.id==='preview-btn')) return;
      if(f.getAttribute('data-confirmed')==='1'){ f.removeAttribute('data-confirmed'); return; }
      ev.preventDefault(); ev.stopImmediatePropagation();
      if(panel) return;
      var publish=f.getAttribute('data-confirm-publish')==='publish';
      panel=document.createElement('div'); panel.className='notice'; panel.id='publish-confirm'; panel.setAttribute('role','alertdialog'); panel.setAttribute('aria-labelledby','publish-confirm-text'); panel.style.margin='12px 0';
      var p=document.createElement('p'); p.id='publish-confirm-text';
      var b=document.createElement('strong'); b.textContent=addr();
      if(publish){ p.appendChild(document.createTextNode("You're about to publish your website. It will be live at ")); p.appendChild(b); p.appendChild(document.createTextNode(' for anyone to see. Publish now?')); }
      else { p.appendChild(document.createTextNode("You're about to create your website at ")); p.appendChild(b); p.appendChild(document.createTextNode(". It won't be live until you publish it. Create it now?")); }
      var row=document.createElement('div'); row.className='buttons';
      var yes=document.createElement('button'); yes.type='button'; yes.className='btn'; yes.textContent=publish?'Yes, publish':'Yes, create it';
      var no=document.createElement('button'); no.type='button'; no.className='btn ghost'; no.textContent='Go back';
      yes.addEventListener('click',function(){ close(); f.setAttribute('data-confirmed','1'); if(f.requestSubmit) f.requestSubmit(); else f.submit(); });
      no.addEventListener('click',close);
      row.appendChild(yes); row.appendChild(no); panel.appendChild(p); panel.appendChild(row);
      var at=f.querySelector('#submit'); var host=at&&at.parentNode&&at.parentNode.parentNode===f?at.parentNode:null;
      if(host) f.insertBefore(panel,host.nextSibling); else f.parentNode.insertBefore(panel,f.nextSibling);
      yes.focus();
    });
  });
})();`;

// Shrinks photos client-side, posts with fetch, shows field errors inline.
// Falls back to the normal multipart post when anything here is unsupported.
const BUILDER_SCRIPT = `
(function(){
  var form=document.getElementById('builder'); if(!form||!window.fetch||!window.FormData) return;
  var FIELDS=${JSON.stringify(FIELD_ORDER)};
  // The Menu upload only applies to food businesses: show it when the owner
  // picks a matching category, hide it otherwise (data-menu-cats lists them).
  // Category-gated sections (Menu, Class schedule, …) reveal when the owner
  // picks a matching category. Each carries data-show-cats; one loop toggles all.
  var catSel=document.getElementById('category');
  var gatedFs=[].slice.call(document.querySelectorAll('[data-show-cats]'));
  if(catSel&&gatedFs.length){ var updGated=function(){ gatedFs.forEach(function(fs){ fs.hidden=(fs.getAttribute('data-show-cats')||'').split(',').indexOf(catSel.value)<0; }); }; catSel.addEventListener('change',updGated); updGated(); }
  // Edit page: "Upload menu" uploads the chosen file(s) on their own and shows
  // the thumbnail at once, without saving the whole form.
  var upBtn=document.getElementById('menu-upload-btn');
  if(upBtn){
    var mInput=document.getElementById('menu'),mStatus=document.getElementById('menu-status'),mCur=document.getElementById('menu-current'),mCurH=document.getElementById('menu-current-h');
    var renderMenu=function(list){
      while(mCur.firstChild) mCur.removeChild(mCur.firstChild);
      list.forEach(function(item,i){
        var card=document.createElement('div');card.className='photo';
        if(item.pdf){ var doc=document.createElement('div');doc.className='menu-doc';doc.textContent='PDF menu '+(i+1);card.appendChild(doc); }
        else { var img=document.createElement('img');img.src=item.url;img.alt='Menu '+(i+1);card.appendChild(img); }
        var ctl=document.createElement('div');ctl.className='photo-ctl';
        var lab=document.createElement('label');lab.className='pkeep';
        var cb=document.createElement('input');cb.type='checkbox';cb.name='keepMenu';cb.value=item.key;cb.checked=true;
        lab.appendChild(cb);lab.appendChild(document.createTextNode(item.pdf?' Keep':' Keep menu '+(i+1)));
        ctl.appendChild(lab);
        if(item.pdf){ var a=document.createElement('a');a.className='tpl-preview';a.href=item.url;a.target='_blank';a.rel='noopener';a.textContent='View ↗';ctl.appendChild(a); }
        card.appendChild(ctl);mCur.appendChild(card);
      });
      if(mCurH) mCurH.hidden=list.length===0;
    };
    upBtn.addEventListener('click',function(){
      if(!mInput.files||!mInput.files.length){ mStatus.textContent='Choose a file first.'; return; }
      mStatus.textContent='Uploading…';upBtn.disabled=true;
      var fd=new FormData();var keyEl=form.querySelector('input[name=key]');if(keyEl)fd.append('key',keyEl.value);
      for(var i=0;i<mInput.files.length;i++) fd.append('menu',mInput.files[i]);
      fetch(form.action+'/menu',{method:'POST',body:fd,headers:{accept:'application/json'}})
        .then(function(r){return r.json();})
        .then(function(res){ upBtn.disabled=false;
          if(res&&res.ok){ renderMenu(res.menu); mInput.value=''; mStatus.textContent='Uploaded.'; }
          else { mStatus.textContent=(res&&res.error)||'Upload failed.'; }
        }).catch(function(){ upBtn.disabled=false; mStatus.textContent='Upload failed. Try again.'; });
    });
  }
  // Reorder existing photos with the arrows; the "keep" inputs' DOM order is the saved order.
  var plist=document.getElementById('photolist');
  if(plist){
    var renumber=function(){ [].forEach.call(plist.querySelectorAll('.photo img'),function(im,i){ im.alt='Photo '+(i+1); }); };
    plist.addEventListener('click',function(ev){
      var rm=ev.target.closest&&ev.target.closest('.premove');
      if(rm){ var rc=rm.closest('.photo'); if(rc){ rc.parentNode.removeChild(rc); renumber(); } return; }
      var btn=ev.target.closest&&ev.target.closest('.pmove'); if(!btn)return;
      var card=btn.closest('.photo'); if(!card)return;
      if(btn.getAttribute('data-dir')==='up'){ if(card.previousElementSibling) plist.insertBefore(card,card.previousElementSibling); }
      else if(card.nextElementSibling){ plist.insertBefore(card.nextElementSibling,card); }
      renumber();
    });
    // Drag and drop (desktop; touch uses the arrows). The DOM order is the saved order.
    var drag=null;
    var afterCard=function(x,y){
      var els=plist.querySelectorAll('.photo:not(.dragging)');
      for(var i=0;i<els.length;i++){ var b=els[i].getBoundingClientRect();
        if(y<b.top) return els[i];
        if(y<=b.bottom && x<b.left+b.width/2) return els[i]; }
      return null;
    };
    plist.addEventListener('dragstart',function(e){ var c=e.target.closest&&e.target.closest('.photo'); if(!c)return; drag=c; c.classList.add('dragging'); if(e.dataTransfer){e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain','');}catch(_){}} });
    plist.addEventListener('dragend',function(){ if(drag)drag.classList.remove('dragging'); drag=null; renumber(); });
    plist.addEventListener('dragover',function(e){ if(!drag)return; e.preventDefault(); var ref=afterCard(e.clientX,e.clientY); if(ref==null){ if(plist.lastElementChild!==drag) plist.appendChild(drag); } else if(ref!==drag){ plist.insertBefore(drag,ref); } });
  }
  // A "Clear" button on every text box.
  [].forEach.call(form.querySelectorAll('textarea'),function(ta){
    var b=document.createElement('button'); b.type='button'; b.className='clearfield'; b.textContent='Clear';
    b.addEventListener('click',function(){ ta.value=''; try{ta.dispatchEvent(new Event('input',{bubbles:true}));}catch(_){} ta.focus(); });
    if(ta.parentNode) ta.parentNode.insertBefore(b,ta.nextSibling);
  });
  // Clear a not-yet-saved photo or video selection.
  var fileClear=function(input,label){
    if(!input)return;
    var cb=document.createElement('button'); cb.type='button'; cb.className='clearfield'; cb.hidden=true;
    if(input.parentNode) input.parentNode.insertBefore(cb,input.nextSibling);
    var sync=function(){ var n=input.files?input.files.length:0; cb.hidden=!n; if(n) cb.textContent=n>1?('Clear '+n+' selected'):('Clear '+label); };
    cb.addEventListener('click',function(){ input.value=''; sync(); });
    input.addEventListener('change',sync); sync();
  };
  fileClear(document.getElementById('photos'),'photo');
  fileClear(document.getElementById('video'),'video');
  // Prefill "Services and prices" from the chosen business type. Only replaces
  // an empty box or an untouched earlier suggestion, so typed content is kept
  // (including if you just tab past it).
  var SERVICE_TEMPLATES=${JSON.stringify(SERVICE_TEMPLATES)};
  var svc=document.getElementById('services'), catSel=document.getElementById('category');
  if(svc && catSel){
    var lastFill='';
    // If the box already holds one of the category templates (an untouched prefill,
    // e.g. on the edit page), treat it as replaceable so changing the type updates it.
    for(var _k in SERVICE_TEMPLATES){ if(SERVICE_TEMPLATES[_k] && svc.value.trim()===SERVICE_TEMPLATES[_k].trim()){ lastFill=svc.value; break; } }
    var fillServices=function(){
      var t=SERVICE_TEMPLATES[catSel.value];
      if(typeof t!=='string') return; // unknown / "Choose one": leave as-is
      // Replace an empty box or an untouched suggestion — including clearing it
      // when the type has no template (e.g. "Other local business").
      if(svc.value.trim()==='' || svc.value===lastFill){ svc.value=t; lastFill=t; }
    };
    // Recolour the style thumbnails to the chosen business type's palette — or,
    // when the owner picks a brand colour, to that colour (mirrors render.ts
    // withBrandColor: deepened primary + a light band tint).
    var CAT_THUMB=${JSON.stringify(CAT_THUMB_COLORS)};
    var tplBox=document.querySelector('.templates');
    var _crgb=function(h){h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};
    var _chex=function(a){var p=function(v){v=Math.max(0,Math.min(255,Math.round(v)));return ('0'+v.toString(16)).slice(-2);};return '#'+p(a[0])+p(a[1])+p(a[2]);};
    var _clum=function(c){var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]);};
    var _cdeepen=function(h){var c=_crgb(h);for(var i=0;i<40&&1.05/(_clum(c)+0.05)<4.5;i++){c=[c[0]*0.92,c[1]*0.92,c[2]*0.92];}return _chex(c);};
    var _cmix=function(h,k){var c=_crgb(h);return _chex([c[0]*k+255*(1-k),c[1]*k+255*(1-k),c[2]*k+255*(1-k)]);};
    var paintThumbs=function(){
      if(!tplBox) return;
      var chk=document.querySelector('input[name=customColor]'), inp=document.getElementById('brandColor');
      if(chk&&chk.checked&&inp&&/^#[0-9a-fA-F]{6}$/.test(inp.value)){
        tplBox.style.setProperty('--tp',_cdeepen(inp.value));
        tplBox.style.setProperty('--tb',_cmix(inp.value,0.12));
        return;
      }
      var c=CAT_THUMB[catSel.value]; if(c){ tplBox.style.setProperty('--tp',c.p); tplBox.style.setProperty('--tb',c.b); }
    };
    catSel.addEventListener('change',paintThumbs); paintThumbs();
    catSel.addEventListener('change',fillServices);
    if(svc.value.trim()==='') fillServices();
  }
  // Brand colour: reveal the picker when ticked; swatches set the colour and tick
  // it; any change repaints the style thumbnails AND the "Preview this style"
  // links so the opened preview shows the chosen (unsaved) colour via ?brand=.
  var bcChk=document.querySelector('input[name=customColor]'), bcBody=document.querySelector('.bc-body'), bcInput=document.getElementById('brandColor');
  var brandNow=function(){ return (bcChk&&bcChk.checked&&bcInput&&/^#[0-9a-fA-F]{6}$/.test(bcInput.value))?bcInput.value:null; };
  var updatePreviewLinks=function(){ var c=brandNow(); [].slice.call(document.querySelectorAll('a.tpl-preview')).forEach(function(a){ try{ var u=new URL(a.href); if(c) u.searchParams.set('brand',c); else u.searchParams.delete('brand'); a.href=u.toString(); }catch(e){} }); };
  var repaint=function(){ if(typeof paintThumbs==='function') paintThumbs(); updatePreviewLinks(); };
  if(bcChk&&bcBody){ var bcSync=function(){ bcBody.hidden=!bcChk.checked; repaint(); }; bcChk.addEventListener('change',bcSync); bcSync(); }
  if(bcInput){ bcInput.addEventListener('input',repaint); }
  [].slice.call(document.querySelectorAll('.bc-sw')).forEach(function(s){ s.addEventListener('click',function(){ var c=s.getAttribute('data-c'); if(bcInput) bcInput.value=c; if(bcChk&&!bcChk.checked){ bcChk.checked=true; if(bcBody) bcBody.hidden=false; } repaint(); }); });
  // Opening hours: offer a weekly template to edit; it stays once touched, and
  // an existing site's hours are never overwritten.
  var HOURS_TEMPLATE=${JSON.stringify(HOURS_TEMPLATE)};
  var hrs=document.getElementById('hours');
  if(hrs){
    // Highlight the chosen website-style card.
    [].slice.call(document.querySelectorAll('.tpl input[type=radio]')).forEach(function(r){
      r.addEventListener('change',function(){
        [].slice.call(document.querySelectorAll('.tpl')).forEach(function(l){ l.classList.remove('sel'); });
        var lab=r.closest&&r.closest('.tpl'); if(r.checked&&lab) lab.classList.add('sel');
      });
    });
    var fillHours=function(){ if(hrs.value.trim()==='') hrs.value=HOURS_TEMPLATE; };
    if(catSel) catSel.addEventListener('change',fillHours);
    fillHours();
  }
  // Inline check for phone and email on blur, mirroring the server's rules.
  var setErr=function(id,msg){ var el=document.getElementById('err-'+id); if(el) el.textContent=msg||''; };
  var emailEl=document.getElementById('email');
  if(emailEl) emailEl.addEventListener('blur',function(){
    var val=emailEl.value.trim();
    setErr('email', val && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val) ? 'Enter a valid email, like you@example.com.' : '');
  });
  var phoneEl=document.getElementById('phone');
  if(phoneEl) phoneEl.addEventListener('blur',function(){
    var val=phoneEl.value.trim(), d=val.replace(/\\D/g,'');
    setErr('phone', val && (d.length<7||d.length>15||/[^\\d\\s()+.-]/.test(val)) ? 'Enter a phone number, like (201) 555-0100.' : '');
  });
  var slug=document.getElementById('slug'), status=document.getElementById('slug-status');
  if(slug && !slug.readOnly){
    var touched=slug.value!=='', timer=null, seq=0;
    var val=function(id){ var el=document.getElementById(id); return el?el.value:''; };
    var show=function(res){
      status.textContent='';
      var p=document.createElement('span');
      if(slug.dataset.original && slug.value===slug.dataset.original){ p.textContent='Your current address'; status.appendChild(p); return; }
      if(res.available){ p.className='ok'; p.textContent='✓ '+res.address+'.'+slug.dataset.domain+' is available'; }
      else { p.className='bad'; p.textContent=res.problem||'Not available'; }
      status.appendChild(p);
      if(!res.available && res.suggestions && res.suggestions.length){
        var t=document.createElement('div'); t.textContent='Try: ';
        res.suggestions.forEach(function(s){ var b=document.createElement('button'); b.type='button'; b.textContent=s; b.addEventListener('click',function(){ slug.value=s; touched=true; check(); }); t.appendChild(b); });
        status.appendChild(t);
      }
    };
    var check=function(){
      var my=++seq;
      var q='/api/address?slug='+encodeURIComponent(touched?slug.value:'')+'&name='+encodeURIComponent(val('businessName'))+'&category='+encodeURIComponent(val('category'))+'&city='+encodeURIComponent(val('city'));
      fetch(q,{headers:{accept:'application/json'}}).then(function(r){return r.json();}).then(function(res){
        if(my!==seq) return;
        if(!touched && res.address){ slug.value=res.address; }
        else if(touched && res.address && res.address!==slug.value && document.activeElement!==slug){ slug.value=res.address; }
        show(res);
      }).catch(function(){});
    };
    var later=function(){ clearTimeout(timer); timer=setTimeout(check,350); };
    slug.addEventListener('input',function(){ touched=true; later(); });
    slug.addEventListener('blur',function(){ touched=slug.value!==''; check(); });
    ['businessName','category','city'].forEach(function(id){ var el=document.getElementById(id); if(el){ el.addEventListener('input',function(){ if(!touched) later(); }); el.addEventListener('change',function(){ if(!touched) later(); }); } });
    if(slug.value || val('businessName')) check();
  }
  function shrink(file){
    return new Promise(function(resolve){
      if(!window.createImageBitmap){ resolve(file); return; }
      createImageBitmap(file).then(function(bmp){
        var max=1600, s=Math.min(1, max/Math.max(bmp.width,bmp.height));
        var c=document.createElement('canvas'); c.width=Math.round(bmp.width*s); c.height=Math.round(bmp.height*s);
        c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
        c.toBlob(function(b){ resolve(b && b.size < file.size ? new File([b], (file.name||'photo').replace(/\\.\\w+$/,'')+'.jpg', {type:'image/jpeg'}) : file); }, 'image/jpeg', 0.82);
      }).catch(function(){ resolve(file); });
    });
  }
  // "Preview my website": a normal post to /preview in a new tab, never the fetch below.
  // "Refresh preview" (edit page, right side) is the same kind of button, aimed at the view frame.
  var previewing=false;
  [].forEach.call(document.querySelectorAll('[data-preview]'),function(b){ b.addEventListener('click',function(){ previewing=true; setTimeout(function(){ previewing=false; },0); }); });
  form.addEventListener('submit', function(ev){
    if(previewing||(ev.submitter&&ev.submitter.hasAttribute('data-preview'))) return;
    ev.preventDefault();
    var btn=document.getElementById('submit'); btn.disabled=true; var label=btn.textContent; btn.textContent='Working…';
    FIELDS.concat(['form']).forEach(function(f){ var el=document.getElementById('err-'+f); if(el) el.textContent=''; });
    var fd=new FormData(form); var files=fd.getAll('photos').filter(function(f){ return f && f.size; }); fd.delete('photos');
    var BA=${JSON.stringify(BEFORE_AFTER_FIELDS.flat())};
    var baDone=Promise.all(BA.map(function(n){ var f=fd.get(n); return f && f.size ? shrink(f).then(function(s){ fd.set(n, s); }) : null; }));
    Promise.all(files.map(shrink)).then(function(small){
      small.forEach(function(f){ fd.append('photos', f); });
      return baDone;
    }).then(function(){
      return fetch(form.action,{method:'POST',body:fd,headers:{accept:'application/json'}});
    }).then(function(r){ return r.json().catch(function(){ return {ok:false,errors:{form:'Something went wrong. Please try again.'}}; }); })
    .then(function(res){
      if(res.ok){
        // Tabbed edit page: back to the edit page (fresh form, the right side shows the saved site), same tab.
        if(res.edit&&form.hasAttribute('data-owner-tabs')){ var k=form.querySelector('input[name=key]'); window.location.href=res.edit+'?'+(k&&k.value?'k='+encodeURIComponent(k.value)+'&':'')+'saved=1'+(location.hash||'#edit'); return; }
        window.location.href=res.next; return;
      }
      var first=null;
      Object.keys(res.errors||{}).forEach(function(k){ var el=document.getElementById('err-'+k)||document.getElementById('err-form'); el.textContent=res.errors[k]; if(!first) first=el; });
      if(first) first.scrollIntoView({behavior:'smooth',block:'center'});
      btn.disabled=false; btn.textContent=label;
    }).catch(function(){ document.getElementById('err-form').textContent='Could not reach SiteVault. Check your connection and try again.'; btn.disabled=false; btn.textContent=label; });
  });
})();`;

/**
 * AdVault create mode: the site is made. The embed script posts
 * `sitevault:created` to AdVault's origin only (data attributes below);
 * AdVault verifies it server side, then pays or publishes.
 */
export function embedCreatedPage(opts: { slug: string; siteUrl: string; pending: boolean; draft: string; nonce: string }): string {
  const body = `<section>
<div class="notice" id="embed-created" role="status" data-slug="${esc(opts.slug)}" data-site-url="${esc(opts.siteUrl)}" data-pending="${opts.pending ? "1" : "0"}" data-draft="${esc(opts.draft)}">
  <h1 style="margin-top:0">Created</h1>
  <p>Your website is made: <strong>${esc(opts.siteUrl)}</strong></p>
  <p style="margin-bottom:0">${opts.pending ? "It goes live as soon as you've paid in AdVault." : "It's live. You can change anything on it at any time."}</p>
</div>
</section>`;
  return layout({ title: "Website created — SiteVault", body, nonce: opts.nonce, noindex: true, embed: true, script: EMBED_SCRIPT });
}

export function donePage(opts: {
  siteUrl: string;
  editUrl: string;
  nonce: string;
  /** BILLING on and made on SiteVault: the site waits for payment. */
  publish?: { slug: string; key: string; prices: BillingView["prices"] };
  signedIn?: boolean;
  admin?: boolean;
}): string {
  const pub = opts.publish;
  const ready = pub
    ? `<div class="notice" style="margin-top:16px">
  <p><strong>Publish your website.</strong> It's saved, but visitors see "This site isn't published yet" until you pay. Pro adds visitor stats: how many people visit, where they come from, and how many tap to call.</p>
  ${publishButtons(pub.slug, pub.key, pub.prices, opts.siteUrl)}
</div>`
    : "";
  return layout({
    title: pub ? "Your website is ready — SiteVault" : "Your website is live — SiteVault",
    noindex: true,
    signedIn: opts.signedIn,
    admin: opts.admin,
    owner: opts.signedIn,
    nonce: opts.nonce,
    script: PUBLISH_CONFIRM_SCRIPT + `document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied';});});});`,
    body: `<section>
<h1>${pub ? "Your website is ready" : "Your website is live 🎉"}</h1>
<div class="notice ok">
  <p><strong>Your website</strong></p>
  <div class="copybox"><code>${esc(opts.siteUrl)}</code><button class="btn ghost" type="button" data-copy="${esc(opts.siteUrl)}">Copy</button><a class="btn" href="${esc(opts.siteUrl)}" target="_blank">Open</a></div>
</div>
<div class="notice" style="margin-top:16px">
  <p><strong>Your private edit link. Save it now.</strong> Use it to change your site any time, or sign in and open <a href="/account">My website</a>. Anyone with it can edit, so don't share it. Bookmark this page or email the link to yourself.</p>
  <div class="copybox"><code>${esc(opts.editUrl)}</code><button class="btn ghost" type="button" data-copy="${esc(opts.editUrl)}">Copy</button></div>
</div>
${ready}
<h2>Next steps</h2>
<ul>
  <li>Add the link to your <strong>Google Business Profile</strong> (Website field).</li>
  <li>Use it as the website on your <a href="https://advault.3pandalabs.com">AdVault</a> video ads.</li>
  <li>Put it on your business cards, van and social profiles.</li>
</ul>
<p>Lost your edit link? Email <a href="mailto:${CONTACT}">${CONTACT}</a> from the email on your site.</p>
</section>`,
  });
}

/** The build form's account part: sign up as you build, or say which account it goes to. */
function accountFields(
  account: { email: string } | null,
  v: (name: string, fallback?: string) => string,
  e: (name: string) => string,
): string {
  if (account) {
    return `<p class="hint" style="margin:16px 0">This website will be saved to your account, <strong>${esc(account.email)}</strong>.</p>`;
  }
  return `<fieldset><legend>Your account</legend>
  <p class="hint">Sign in any time to edit your website, pay and see visitors. This 3PandaLabs account also works on AdVault. Already have one (SiteVault or AdVault)? <a href="/login?next=/new">Sign in first</a>.</p>
  <div class="field"><label for="acct_email">Email</label><input type="email" id="acct_email" name="acct_email" autocomplete="email" required maxlength="200" value="${v("acct_email", "")}">${e("acct_email")}</div>
  <div class="field"><label for="acct_password">Password <span class="hint">At least 10 characters</span></label><input type="password" id="acct_password" name="acct_password" autocomplete="new-password" required minlength="10" maxlength="200">${e("acct_password")}</div>
</fieldset>`;
}

/** Sign in, or create an account without building a website first. */
export function authPage(kind: "login" | "signup", opts: { error?: string; email?: string; next?: string; reset?: boolean } = {}): string {
  const login = kind === "login";
  const next = opts.next && /^\/[a-z0-9/_?=&-]*$/i.test(opts.next) ? opts.next : "/account";
  return layout({
    title: `${login ? "Sign in" : "Create your account"} — SiteVault`,
    noindex: true,
    body: `<section class="narrow" style="max-width:440px">
<h1>${login ? "Sign in" : "Create your account"}</h1>
${login && opts.reset ? `<p class="notice ok" role="status">Your password has been changed. Sign in with your new password.</p>` : ""}
${opts.error ? `<p class="notice warn" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/${login ? "login" : "signup"}">
  <input type="hidden" name="next" value="${esc(next)}">
  <div class="field"><label for="email">Email</label><input type="email" id="email" name="email" autocomplete="email" required maxlength="200" value="${esc(opts.email ?? "")}"></div>
  <div class="field"><label for="password">Password${login ? "" : ` <span class="hint">At least 10 characters</span>`}</label><input type="password" id="password" name="password" autocomplete="${login ? "current-password" : "new-password"}" required minlength="${login ? 1 : 10}" maxlength="200"></div>
  ${login ? `<p style="margin:-6px 0 16px;text-align:right"><a href="/forgot-password">Forgot your password?</a></p>` : ""}
  <button class="btn" type="submit">${login ? "Sign in" : "Create account"}</button>
</form>
<p class="hint" style="margin-top:20px">${
      login
        ? `<strong>One 3PandaLabs login:</strong> the same email and password work on SiteVault and <a href="https://advault.3pandalabs.com">AdVault</a>, whichever you signed up on.<br>New here? <a href="/signup">Create an account</a> or <a href="/new">build your website</a>.`
        : `This is your 3PandaLabs account: it also signs you in to <a href="https://advault.3pandalabs.com">AdVault</a>. Already have one (from SiteVault or AdVault)? <a href="/login">Sign in</a>.`
    }</p>
</section>`,
  });
}

/** "Forgot password": ask for an email, then a check-your-email confirmation. */
export function forgotPasswordPage(opts: { error?: string; email?: string; sent?: boolean } = {}): string {
  const body = opts.sent
    ? `<section class="narrow" style="max-width:440px">
<h1>Check your email</h1>
<p class="notice ok" role="status">We've sent a link to choose a new password. It works once and expires in 30 minutes.</p>
<p class="hint" style="margin-top:20px">Didn't get it? Check your spam folder, or <a href="/forgot-password">try again</a>. Still stuck? Email <a href="mailto:sitevault@3pandalabs.com">sitevault@3pandalabs.com</a>.</p>
<p class="hint"><a href="/login">Back to sign in</a></p>
</section>`
    : `<section class="narrow" style="max-width:440px">
<h1>Reset your password</h1>
<p class="hint">Enter your email and we'll send a link to choose a new one.</p>
${opts.error ? `<p class="notice warn" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/forgot-password">
  <div class="field"><label for="email">Email</label><input type="email" id="email" name="email" autocomplete="email" required maxlength="200" value="${esc(opts.email ?? "")}"></div>
  <button class="btn" type="submit">Email me a link</button>
</form>
<p class="hint" style="margin-top:20px"><a href="/login">Back to sign in</a></p>
</section>`;
  return layout({ title: "Reset your password — SiteVault", noindex: true, body });
}

/** "Choose a new password": the reset form, keyed by the token from the email link. */
export function resetPasswordPage(opts: { token?: string; error?: string } = {}): string {
  const body = !opts.token
    ? `<section class="narrow" style="max-width:440px">
<h1>Choose a new password</h1>
<p class="notice warn" role="alert">This reset link is missing or invalid. <a href="/forgot-password">Request a new one</a>.</p>
</section>`
    : `<section class="narrow" style="max-width:440px">
<h1>Choose a new password</h1>
${opts.error ? `<p class="notice warn" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/reset-password">
  <input type="hidden" name="token" value="${esc(opts.token)}">
  <div class="field"><label for="password">New password <span class="hint">At least 10 characters</span></label><input type="password" id="password" name="password" autocomplete="new-password" required minlength="10" maxlength="200"></div>
  <button class="btn" type="submit">Save new password</button>
</form>
</section>`;
  return layout({ title: "Choose a new password — SiteVault", noindex: true, body });
}

export type AccountSite = { slug: string; name: string; siteUrl: string; state: string; pendingReviews?: number; visitors?: VisitorsView };

/** "My websites": every site on the account, and a way to add one made before accounts. */
export function accountPage(
  email: string,
  sites: AccountSite[],
  opts: { claimError?: string; claimed?: boolean; admin?: boolean; pwChanged?: boolean; pwError?: string } = {},
): string {
  const changePw = `<details class="notice" style="margin-top:28px"${opts.pwError ? " open" : ""}><summary><strong>Change your password</strong></summary>
  ${opts.pwError ? `<p class="err" role="alert" style="margin-top:10px">${esc(opts.pwError)}</p>` : ""}
  <form method="post" action="/account/change-password" style="margin-top:12px">
    <div class="field"><label for="currentPassword">Current password</label><input type="password" id="currentPassword" name="currentPassword" autocomplete="current-password" required maxlength="200"></div>
    <div class="field"><label for="newPassword">New password <span class="hint">At least 10 characters</span></label><input type="password" id="newPassword" name="newPassword" autocomplete="new-password" required minlength="10" maxlength="200"></div>
    <button class="btn ghost" type="submit">Update password</button>
  </form>
</details>`;
  // Play requires an in-app way to delete the account. The login is the one
  // 3PandaLabs account stored by AdVault, so this signs the owner in to
  // AdVault (one-tap /go/advault) at its Settings -> Delete account section.
  // The website itself is removed by email (removeSite, no self-service).
  const deleteAccount = `<div class="notice" id="delete-account" style="margin-top:28px">
  <p><strong>Delete my account</strong></p>
  <p class="hint">You have one sign-in for SiteVault and AdVault (both by 3PandaLabs). Deleting it deletes your sign-in for both apps. It's done in AdVault: this button signs you in there and opens Settings, Delete account.</p>
  <p class="hint">Your website is not removed by this. To have it taken offline and its photos deleted, email <a href="mailto:${CONTACT}">${CONTACT}</a> with your web address. <a href="/privacy#delete-account">What is deleted and what is kept</a>.</p>
  <div class="buttons"><a class="btn ghost" href="/go/advault?to=${encodeURIComponent("/dashboard/settings#delete-account")}">Delete my account</a></div>
</div>`;
  const STATE: Record<string, string> = { live: "Live", unpublished: "Not published yet", grace: "Payment overdue", paused: "Paused" };
  const claimForm = `<form method="post" action="/account/claim" class="notice" style="margin-top:28px">
  <p><strong>Made a website before accounts existed?</strong> Paste its private edit link to add it here.</p>
  ${opts.claimError ? `<p class="err" role="alert">${esc(opts.claimError)}</p>` : ""}
  <div class="field"><label for="editLink">Edit link</label><input id="editLink" name="editLink" type="url" required placeholder="https://sitevault.3pandalabs.com/edit/..."></div>
  <button class="btn ghost" type="submit">Add to my account</button>
</form>`;
  const footer = opts.admin
    ? `<div class="buttons" style="margin-top:20px"><a class="btn" href="/new">Build another website</a></div>${claimForm}`
    : sites.length
      ? `<p class="hint" style="margin-top:20px">One website per account. Another business? Sign out and create a new account for it.</p>`
      : claimForm;
  const rows = sites.length
    ? sites
        .map((s) => {
          const n = s.pendingReviews ?? 0;
          const label = `${n} review${n === 1 ? "" : "s"} pending approval`;
          const bell = n
            ? `<a href="/edit/${esc(s.slug)}#reviews" title="${label}" aria-label="${label}" style="position:relative;flex-shrink:0;text-decoration:none;font-size:1.35rem;line-height:1">🔔<span style="position:absolute;top:-6px;right:-9px;background:#ef4444;color:#fff;font-size:.66rem;font-weight:700;min-width:16px;height:16px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0 3px">${n}</span></a>`
            : "";
          const cardId = `site-${esc(s.slug)}`;
          const statsId = `vstats-${esc(s.slug)}`;
          return `<div class="card" id="${cardId}" style="margin-bottom:12px"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px"><h3 style="margin:0">${esc(s.name)}</h3>${bell}</div>
  <p class="hint" style="margin:6px 0 10px"><a href="${esc(s.siteUrl)}" target="_blank" rel="noopener">${esc(s.siteUrl)}</a> · ${esc(STATE[s.state] ?? s.state)}</p>
  <div class="buttons"><a class="btn" href="/edit/${esc(s.slug)}#edit">Edit your website</a><a class="btn ghost" href="/edit/${esc(s.slug)}#view">View your website</a>${s.visitors ? `<a class="btn ghost" href="#${statsId}">Visitors stats</a>` : `<a class="btn ghost" href="/edit/${esc(s.slug)}#stats">Visitors stats</a>`}</div>
  ${s.visitors ? visitorsSection(s.visitors, false, false, { id: statsId, closeHref: `#${cardId}` }) : ""}</div>`;
        })
        .join("")
    : `<p>No website on this account yet. <a href="/new">Build it</a>, or add one you already made below.</p>`;
  return layout({
    title: "My website — SiteVault",
    noindex: true,
    owner: sites.length > 0,
    signedIn: true,
    admin: opts.admin,
    body: `<section>
<h1>${opts.admin ? "My websites" : "My website"}</h1>
<p class="hint">Signed in as ${esc(email)}${opts.admin ? " · admin (unlimited websites, published free)" : ""}</p>
${opts.admin ? `<div class="buttons" style="margin:14px 0 26px"><a class="btn" href="/admin">Admin dashboard</a></div>` : ""}
${opts.claimed ? `<p class="notice ok" role="status">Added to your account.</p>` : ""}
${opts.pwChanged ? `<p class="notice ok" role="status">Your password has been changed.</p>` : ""}
${rows}
${footer}
${changePw}
${deleteAccount}
</section>`,
  });
}

export type AdminSite = { slug: string; name: string; category: string; source: string; state: string; siteUrl: string };

const ADMIN_STATE_LABEL: Record<string, string> = { live: "Published", unpublished: "Unpublished", grace: "Payment overdue", paused: "Paused" };

const ADMIN_TAB_SCRIPT = `(function(){
  var tabs=[].slice.call(document.querySelectorAll('.tab')); if(!tabs.length) return;
  function show(id){ tabs.forEach(function(t){ var on=t.getAttribute('data-tab')===id; t.classList.toggle('active',on); var p=document.getElementById(t.getAttribute('data-tab')); if(p) p.classList.toggle('hidden',!on); }); }
  tabs.forEach(function(t){ t.addEventListener('click',function(){ show(t.getAttribute('data-tab')); }); });
  show('overview');
})();`;

const catLabel = (c: string) => CATEGORIES[c as keyof typeof CATEGORIES]?.label ?? c;

/** Admin-only dashboard: every customer website, status totals, per-category stats. */
export function adminPage(sites: AdminSite[], nonce: string): string {
  const count = (st: string) => sites.filter((s) => s.state === st).length;
  const fromAdvault = sites.filter((s) => s.source === "advault").length;
  const tile = (label: string, n: number) => `<div class="tile"><div class="tile-n">${n}</div><div class="tile-l">${esc(label)}</div></div>`;

  const byCat = new Map<string, { total: number; published: number }>();
  for (const s of sites) {
    const e = byCat.get(s.category) ?? { total: 0, published: 0 };
    e.total++;
    if (s.state === "live") e.published++;
    byCat.set(s.category, e);
  }
  const catRows =
    [...byCat.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(
        ([cat, e]) =>
          `<tr><th scope="row">${esc(catLabel(cat))}</th><td class="n">${e.total}</td><td class="n">${e.published}</td><td class="n">${e.total - e.published}</td></tr>`,
      )
      .join("") || `<tr><td colspan="4">No websites yet.</td></tr>`;

  const siteRows =
    sites
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (s) =>
          `<tr><th scope="row">${esc(s.name)}</th><td>${esc(catLabel(s.category))}</td><td><span class="badge ${esc(s.state)}">${esc(ADMIN_STATE_LABEL[s.state] ?? s.state)}</span></td><td>${s.source === "advault" ? "AdVault" : "SiteVault"}</td><td><a href="${esc(s.siteUrl)}" target="_blank" rel="noopener">open</a> · <a href="/edit/${esc(s.slug)}">edit</a></td></tr>`,
      )
      .join("") || `<tr><td colspan="5">No websites yet.</td></tr>`;

  return layout({
    title: "Admin — SiteVault",
    helper: false,
    noindex: true,
    signedIn: true,
    admin: true,
    nonce,
    script: ADMIN_TAB_SCRIPT,
    body: `<section>
<h1>Admin</h1>
<p class="hint">Every customer website across SiteVault. <a href="/account">Back to my account</a>.</p>
<div class="tabs" role="tablist">
  <button class="tab" type="button" data-tab="overview">Overview</button>
  <button class="tab" type="button" data-tab="categories">By category</button>
  <button class="tab" type="button" data-tab="websites">All websites (${sites.length})</button>
</div>
<div id="overview" class="tabpanel">
  <div class="tiles">${tile("Total websites", sites.length)}${tile("Published", count("live"))}${tile("Unpublished", count("unpublished"))}${tile("Payment overdue", count("grace"))}${tile("Paused", count("paused"))}${tile("From AdVault", fromAdvault)}</div>
</div>
<div id="categories" class="tabpanel">
  <div class="tablewrap"><table class="atable"><thead><tr><th>Category</th><th class="n">Total</th><th class="n">Published</th><th class="n">Unpublished</th></tr></thead><tbody>${catRows}</tbody></table></div>
</div>
<div id="websites" class="tabpanel">
  <div class="tablewrap"><table class="atable"><thead><tr><th>Business</th><th>Category</th><th>Status</th><th>Made with</th><th></th></tr></thead><tbody>${siteRows}</tbody></table></div>
</div>
</section>`,
  });
}

/** POST /preview refused the form: what to fix, on a plain page. */
export function previewErrorsPage(errors: Record<string, string>): string {
  const items = Object.values(errors)
    .filter(Boolean)
    .map((e) => `<li>${esc(e)}</li>`)
    .join("");
  return layout({
    title: "Can't preview yet — SiteVault",
    noindex: true,
    body: `<section><h1>Fix these to see your preview</h1><ul>${items}</ul><p>Go back to the other tab, change them, then press <strong>Preview my website</strong> again. Nothing was saved.</p></section>`,
  });
}

export function messagePage(title: string, message: string, status = "Not found"): string {
  return layout({
    title: `${title} — SiteVault`,
    helper: false, // also shown on customer hosts
    noindex: true,
    body: `<section class="hero"><span class="pill">${esc(status)}</span><h1>${esc(title)}</h1><p class="lead">${esc(message)}</p><a class="btn" href="/">Go to SiteVault</a></section>`,
  });
}

export function privacyPage(): string {
  return layout({
    title: "Privacy — SiteVault",
    path: "/privacy",
    body: `<section class="prose">
<h1>Privacy</h1>
<p>Last updated 25 November 2026. SiteVault is run by 3PandaLabs LLC, a New Jersey company. Contact: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<h2>What we store</h2>
<ul>
  <li><strong>The details you enter</strong> (business name, phone, email, address, services, hours and text) and <strong>the photos you upload</strong>. These are published on your website, which is public. Photos are resized for the web.</li>
  <li><strong>Before &amp; after photos</strong>, if the business provides them (on its edit page, or from AdVault): pairs of photos of the business's own work, shown in a "Before &amp; after" section on its website and stored and resized like its other photos. The owner can remove them at any time on the edit page, which deletes them.</li>
  <li>If your site was made from <a href="https://advault.3pandalabs.com">AdVault</a>: your business name, offer, ad photos, any before &amp; after photos you added there and <strong>your video ad</strong>, which AdVault sends us when you launch the ad and choose to show it on your website (or when the website is made, if the ad is your own uploaded video).</li>
  <li><strong>Messages from our contact form</strong> (your name, email, subject and message, and your account ID if you're signed in): emailed to us, through AdVault and our email provider Resend, so we can reply. SiteVault keeps no copy, only a counter for your network address, for up to two hours, to stop abuse. Questions typed into the panda helper are matched to our written answers and not stored.</li>
  <li>If you build your website inside AdVault (the full builder shown on AdVault's "Make me a website"), AdVault first sends us those same details and photos as a <strong>draft</strong> so the builder opens filled in. The draft is kept only to build your website: its photos are deleted once the website is made, and an unused draft expires after an hour and is deleted within a day. Building there signs you in to SiteVault with the same sign-in cookie as above, inside AdVault's page.</li>
  <li><strong>A scrambled copy of your private edit key</strong>, so we can check it without storing the key itself.</li>
  <li><strong>Your account is one 3PandaLabs account, shared with <a href="https://advault.3pandalabs.com">AdVault</a></strong> (our video-ad app, also by 3PandaLabs): the same email and password sign you in to both, whichever you signed up on. Your sign-in (email and a scrambled, hashed copy of your password, which can't be turned back into the password) is stored by AdVault for both apps; when you sign in here we send AdVault the email and password you typed to check them. SiteVault stores your email, your 3PandaLabs account ID and which websites are yours. Accounts made on SiteVault before 16 November 2026 kept their hashed password here; it moves to the shared account the next time you sign in. While you're signed in we keep a session record that expires after 30 days or when you sign out. When you follow a link between SiteVault and AdVault while signed in, we pass a one-time sign-in code (it works once, for 60 seconds, and contains your account ID and email, never your password) so you arrive signed in to the same account.</li>
  <li><strong>Which apps you use</strong>: with your account we record which app you created it on (SiteVault or AdVault) and when you first used each one (your first website here, your first ad campaign in AdVault), so we know whether you use SiteVault, AdVault or both and can offer benefits that depend on it, for example to customers who use only SiteVault.</li>
  <li><strong>A short-lived counter per network address</strong> to limit how many sites can be created in a day. It expires after about a day.</li>
  <li><strong>Visit counts for each website, in total only</strong>: per day, the number of visits and of taps on the call and directions buttons, grouped by rough location (country and city, as worked out by Cloudflare), device type (phone, tablet or computer) and where visitors came from (for example YouTube, Google or a typed-in address). We don't store visitors' IP addresses, the full address of the page they came from, or their browser details, and we keep no record of any individual visitor. The business owner sees these totals on their edit page.</li>
  <li><strong>Visit counts for sitevault.3pandalabs.com itself, in total only</strong>: per day, the section of the site, the kind of place visits came from (for example YouTube, LinkedIn or a site that links to us), country and device type. No IP address, browser details or anything that identifies you, and no record of any one visitor.</li>
  <li><strong>If you pay for a plan</strong>: payments are handled by Stripe, which processes your card details; we never see or store them. We store the Stripe customer and subscription IDs for your website and the email address Stripe gives us for the payer, plus your plan, paid-until date and offer credits.</li>
</ul>
<h2>What we don't do</h2>
<ul>
  <li>No advertising trackers or third-party analytics on SiteVault or on the websites it makes. Visit counts are kept by us (3PandaLabs), as described above.</li>
  <li>One cookie only, and only when you sign in: a sign-in cookie on sitevault.3pandalabs.com that keeps you signed in. The websites we make (on 3pandasite.com) never set or read cookies.</li>
  <li>We don't sell or share your details. They're shown on your website because you asked us to publish them.</li>
</ul>
<h2>Where it's kept</h2>
<p>Sites, photos and visit counts are stored and served by Cloudflare, our hosting provider, in its global network. Visitors' browsers connect to Cloudflare to load your site, as with any website. Payment records are kept by Stripe.</p>
<h2>Your choices</h2>
<p>Change anything at any time with your edit link. Your 3PandaLabs account can be deleted in AdVault (Settings, Delete account) or by emailing us; that ends your sign-in on both apps but doesn't remove your website. To have your website removed, email sitevault@3pandalabs.com with your web address: we confirm with you at the phone number on the site, then take it offline and delete its photos. If you've lost your edit link, email us too and we'll help.</p>
<h2 id="delete-account">Deleting your account</h2>
<p>SiteVault and AdVault share one 3PandaLabs account, stored by AdVault, so the account is deleted in AdVault and deleting it deletes it for both apps.</p>
<ol>
  <li><strong>In the SiteVault app or website:</strong> sign in, open <a href="/account">My website</a> and tap <strong>Delete my account</strong>. It signs you in to AdVault and opens Settings, Delete account; confirm with your password.</li>
  <li><strong>Or in AdVault:</strong> sign in at <a href="https://advault.3pandalabs.com">advault.3pandalabs.com</a> or in the AdVault app and go to Settings, Delete account.</li>
  <li><strong>Can't sign in?</strong> Email <a href="mailto:${CONTACT}">${CONTACT}</a> from your account's email address and we'll delete it for you, within thirty days.</li>
</ol>
<p><strong>What is deleted:</strong> your sign-in (email and hashed password), your name, business details and phone number held by AdVault, and AdVault's connected Google accounts and uploaded photos, at once. Any running AdVault ads stop and any AdVault plan ends. You can no longer sign in to SiteVault or AdVault; a SiteVault session you are already signed in with expires within 30 days, or when you sign out.</p>
<p><strong>What is kept:</strong> AdVault keeps payment and invoice records and the ads they paid for for up to eight years, because tax law requires it, no longer linked to your email (see <a href="https://advault.3pandalabs.com/privacy#delete-account">AdVault's privacy policy</a>). Stripe keeps its own payment records for any SiteVault plan.</p>
<p><strong>Your website is removed separately.</strong> Deleting the account doesn't take your website offline. Email <a href="mailto:${CONTACT}">${CONTACT}</a> with your web address: we confirm with you at the phone number on the site, cancel any yearly renewal, then take it offline and delete its photos, video and before &amp; after photos. We keep a short record of the removed site (its address and text, without photos) so the address is never given to someone else. If you also want SiteVault's own copy of your email and account ID deleted, say so in the same email.</p>
<h2>Children</h2>
<p>SiteVault is for businesses and is not directed at children under 13.</p>
</section>`,
  });
}

export function termsPage(): string {
  return layout({
    title: "Terms — SiteVault",
    path: "/terms",
    body: `<section class="prose">
<h1>Terms</h1>
<p>Last updated 24 November 2026. These terms are between you and 3PandaLabs LLC (New Jersey), which runs SiteVault.</p>
<h2>Your account</h2>
<p>Your SiteVault account is a single 3PandaLabs account shared with AdVault: the same email and password sign you in to both, whichever you created it on, and it is stored by AdVault. Keep your password to yourself; you're responsible for what's done with your account. Deleting the account ends your sign-in on both apps. Each app's own terms apply to what you do in it, and SiteVault plans are billed separately from AdVault.</p>
<h2>Your content</h2>
<p>You must own or run the business, or have its permission. Everything you publish must be true and lawful, and you must have the right to use every photo. Before &amp; after photos must be real photos of your own business's work, not altered to mislead. You keep ownership of your content and give us permission to host and display it on your website.</p>
<h2>Not allowed</h2>
<p>Impersonating another business, misleading claims or prices, collecting passwords or payments, illegal goods or services, adult content, hate, or anything that breaks the law. Links to other websites can't be added to page text. We may remove any site that breaks these rules, without notice.</p>
<h2>Real estate</h2>
<p>Housing-related sites must follow US fair-housing law, including not stating preferences based on protected characteristics.</p>
<h2>Price</h2>
<p>Prices are in US dollars:</p>
<ul>
  <li><strong>Websites made on SiteVault</strong>: free to build; you pay when you publish. Basic is $49 a year to keep the site running; Pro is $89 a year and adds visitor stats.</li>
  <li><strong>Festive season prices</strong>: a plan paid on or before January 31, 2027 is $29 a year for Basic or $59 a year for Pro, and the site keeps these prices for life, including if it switches between Basic and Pro or pays again after a lapse.</li>
  <li><strong>Websites made from AdVault</strong>: $10 one-time, paid in AdVault, which includes the first year of Pro. Pro also stays included while the website owner's AdVault monthly plan runs. Otherwise it continues after the first year as Pro at $49 a year.</li>
  <li><strong>Offer credits</strong>: every site starts with 2. Changing your current special uses 1 credit; clearing it is free. Extra credits are $10 for 5.</li>
</ul>
<p>Plans are billed yearly and renew automatically until you cancel; cancelling stops the next renewal and your site stays up until the end of the paid year. A site made during early access stays free until January 31, 2027. If a payment isn't made, the site stays online for 14 days, then shows a "paused" page with your business name and phone number. We never delete a paused site; paying brings it back. Payments are processed by Stripe. Websites made on SiteVault are billed separately from any AdVault plan. You can have your site removed at any time by emailing sitevault@3pandalabs.com; we cancel its renewal at the same time.</p>
<h2>No guarantee</h2>
<p>SiteVault is provided as is. We work to keep sites online but don't guarantee uninterrupted service. To the extent the law allows, our liability is limited to the amount you've paid us in the last 12 months.</p>
<h2>Law</h2>
<p>These terms are governed by the laws of New Jersey, USA.</p>
</section>`,
  });
}

/**
 * Contact page: a plain form (no script) that emails us through AdVault's API
 * (contactSubmit, index.ts), with the address and phone under it.
 */
export function contactPage(
  opts: { signedIn?: boolean; values?: Partial<Record<"name" | "email" | "subject" | "message", string>>; error?: string; sentTo?: string } = {},
): string {
  const val = (k: "name" | "email" | "subject" | "message") => esc(opts.values?.[k] ?? "");
  return layout({
    signedIn: opts.signedIn,
    title: "Contact — SiteVault",
    path: "/contact",
    body: `<section class="prose">
<h1>Contact us</h1>
<p>SiteVault is made by 3PandaLabs LLC, USA. Quick answers are in the <a href="/faq">FAQ</a>, or send us a question or feedback:</p>
${
  opts.sentTo !== undefined
    ? `<p class="notice" role="status">Thanks, your message was sent. We'll reply to ${esc(opts.sentTo)}.</p>`
    : `${opts.error ? `<p class="notice warn" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/contact">
  <div class="field"><label for="c-name">Name</label><input type="text" id="c-name" name="name" autocomplete="name" required maxlength="120" value="${val("name")}"></div>
  <div class="field"><label for="c-email">Email</label><input type="email" id="c-email" name="email" autocomplete="email" required maxlength="254" value="${val("email")}"></div>
  <div class="field"><label for="c-subject">Subject</label><input type="text" id="c-subject" name="subject" required maxlength="150" value="${val("subject")}"></div>
  <div class="field"><label for="c-message">Question or feedback</label><textarea id="c-message" name="message" rows="6" required maxlength="4000">${val("message")}</textarea></div>
  <div aria-hidden="true" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden"><label for="c-website">Website</label><input type="text" id="c-website" name="website" tabindex="-1" autocomplete="off"></div>
  <button class="btn" type="submit">Send</button>
</form>`
}
<p style="margin-top:20px">Or email <a href="mailto:${CONTACT}">${esc(CONTACT)}</a></p>
<p>Prefer to call? <a href="tel:+13323168453">+1 (332) 316-8453</a></p>
<h2>Website owners</h2>
<p>Editing your website? Use the edit link from when you built it, or sign in and open <a href="/account">My website</a>. Want your website taken down? Email us from the address above with your web address, and we'll confirm with you at the phone number on your site before removing it.</p>
</section>`,
  });
}

/** `topics`: the panda helper's (help.ts); its billing answers are listed here too, so prices follow billing.ts. */
export function faqPage(topics: HelpTopic[] = [], signedIn = false): string {
  // [question, answer-html] — answers are first-party copy, so they may contain
  // markup (links/strong) and are not escaped.
  const faqs: [string, string][] = [
    ["What is SiteVault?", "SiteVault builds a clean, professional one-page website for your local business in about five minutes. You add your details — name, services, hours, photos — pick a style, and it goes live. No code, no designer, no monthly hassle. It's made by 3PandaLabs."],
    ["How long does it take, and do I need any tech skills?", "About five minutes, and no skills at all. You fill in a simple form — only your business name, phone and town are required — and everything else just makes your site better. Pick a style and you're live."],
    ["What will my website address be?", "Your site gets its own address at <strong>yourbusiness.3pandasite.com</strong>, included with your plan. You choose the first part when you build it, and you can change it a few times later from the edit page."],
    ["Can I edit my website after it's live?", "Yes, anytime. Use the private edit link you got when you built it, or sign in and open <a href=\"/account\">My website</a>. Your changes go live when you press Save."],
    ["How much does it cost?", "It's free to build and preview. Publishing uses a yearly plan, with no setup fee and no commission. <a href=\"/#plans\">Compare plans and prices</a>."],
    ["Will my website show up on Google?", "It can. Your website is set up so search engines can read and list it, but Google decides what it shows and when, so we can't promise a place or a date. Linking to it from your Google Business Profile and social pages helps Google find it."],
    ["Is my website mobile-friendly?", "Yes. Every SiteVault site automatically looks good and loads fast on phones, tablets and computers."],
    ["How do customers contact me through the site?", "Your site shows your real phone and address with one-tap <strong>Call</strong> and <strong>Directions</strong> buttons. It's a business card, not a form — people reach you directly."],
    ["Do you track my visitors or use cookies?", "No trackers and no third-party cookies on your website. We keep simple, anonymous visit counts so you can see how many people the site reaches — no names, no IP addresses. See our <a href=\"/privacy\">Privacy Policy</a>."],
    ["Can I add photos or a menu?", "Yes. You can add photos, and restaurants and bakeries can upload a menu. Your style and the sections shown adapt to your type of business."],
    ["Can I install it like an app?", "Yes — SiteVault installs as an app on your phone or computer from <a href=\"/\">sitevault.3pandalabs.com</a>, and an Android version is on the way."],
    ["How do I get help, or take my site down?", "Email us anytime — see <a href=\"/contact\">Contact us</a>. To take a site offline, email from your business address with your web address and we'll confirm by phone first."],
  ];
  const billing = topics.filter((t) => t.faq);
  const items = faqs.map(([q, a]) => `<details class="section"><summary>${q}</summary><div class="section-body"><p>${a}</p></div></details>`).join("");
  return layout({
    title: "FAQ — SiteVault",
    path: "/faq",
    signedIn,
    body: `<section class="prose">
<h1>Frequently asked questions</h1>
<p>Quick answers about building and running your SiteVault website. Still stuck? <a href="/contact">Contact us</a>.</p>
${items}
${billing.length ? `<h2>Plans and billing</h2>
${billing.map((t) => `<details class="section"><summary>${esc(t.q)}</summary><div class="section-body"><p>${esc(t.a)}</p></div></details>`).join("")}` : ""}
</section>`,
  });
}
