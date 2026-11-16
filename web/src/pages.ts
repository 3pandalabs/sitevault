// SiteVault's own pages: home, the builder (new + edit), done, privacy, terms.
// Server-rendered HTML. The builder has one small inline script (CSP nonce)
// that shrinks photos in the browser before upload, so a 12 MB phone photo
// arrives as ~300 KB; without JavaScript the form still posts normally.

import { CATEGORIES, HOURS_TEMPLATE, MAX_PHOTOS, SERVICE_TEMPLATES, servicesToText, type FieldErrors, type Site } from "./site.js";
import { MAX_RENAMES } from "./address.js";
import { esc } from "./util.js";
import { DOLLARS, PACK_CREDITS, type Billing, type CheckoutKind, type PlanPrices, type SiteState, type Source } from "./billing.js";
import type { SiteStats } from "./stats.js";

const CONTACT = "3pandas@3pandalabs.com";

/** `owner`: a signed-in owner who already has their website (one per account): no "Build" button. */
export function layout(opts: { title: string; body: string; nonce?: string; script?: string; noindex?: boolean; owner?: boolean; signedIn?: boolean; admin?: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${esc(opts.title)}</title>
<meta name="description" content="A simple website for your local business in about five minutes. Built from your own details and photos.">
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
html,body{max-width:100vw;overflow-x:hidden}
body{margin:0;font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;color:var(--fg);background:var(--bg);line-height:1.6;font-size:16px;min-height:100vh;display:flex;flex-direction:column}
.backdrop{pointer-events:none;position:fixed;inset:0;z-index:-1;overflow:hidden;background:var(--bg)}
.backdrop i{position:absolute;border-radius:9999px;filter:blur(64px)}
.backdrop .b1{top:-10rem;left:-8rem;width:32rem;height:32rem;background:rgba(14,165,233,.20)}
.backdrop .b2{top:-6rem;right:-10rem;width:28rem;height:28rem;background:rgba(124,58,237,.20)}
.backdrop .b3{bottom:-14rem;left:33%;width:34rem;height:34rem;background:rgba(56,189,248,.10)}
.backdrop .dots{position:absolute;inset:0;opacity:.04;background-image:radial-gradient(circle,#f4f4f5 1px,transparent 1px);background-size:24px 24px}
.wrap{max-width:64rem;margin:0 auto;padding:0 24px}
main{flex:1}
a{color:var(--accent-hi)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:24px;padding-bottom:24px;gap:12px}
.brand{font-size:1.125rem;font-weight:600;letter-spacing:-.01em;white-space:nowrap}
.logo{color:var(--fg);text-decoration:none}
.logo span{color:var(--accent)}
.tag{display:inline-block;margin-left:8px;padding-left:8px;border-left:1px solid rgba(244,244,245,.2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;letter-spacing:.1em;color:var(--dim);text-decoration:none;vertical-align:middle}
.tag:hover{color:var(--fg2);text-decoration:underline}
@media (max-width:640px){.tag{display:none}}
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
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin:0 0 12px;max-width:860px}
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
.steps{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:8px 0 40px}
.card{border:1px solid var(--line);border-radius:16px;padding:20px;background:var(--panel)}
.card h3{margin:0 0 6px;font-size:1rem;font-weight:600}
.card p{margin:0;color:var(--muted);font-size:.95rem}
.pill{display:inline-block;border:1px solid rgba(56,189,248,.3);background:rgba(56,189,248,.10);color:#bae6fd;font-weight:500;border-radius:999px;padding:4px 12px;font-size:.75rem;letter-spacing:.05em;text-transform:uppercase;margin-bottom:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
.chips span{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:4px 12px;font-size:.875rem}
section{padding:24px 0}
form .field{margin:0 0 18px}
label{display:block;font-weight:500;margin-bottom:6px;color:var(--fg)}
.hint{display:block;font-weight:400;color:var(--muted);font-size:.85rem}
input[type=text],input[type=tel],input[type=email],input[type=password],input[type=url],select,textarea,input[type=file]{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line2);border-radius:10px;background:rgba(255,255,255,.05);color:var(--fg)}
select option{background:#18181b}
input::placeholder,textarea::placeholder{color:var(--dim)}
textarea{min-height:110px;resize:vertical}
.err{color:var(--err);font-size:.9rem;margin-top:4px}
.err:empty{display:none}
.row{display:grid;gap:0 16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.addr{display:flex;align-items:center;border:1px solid var(--line2);border-radius:10px;background:rgba(255,255,255,.05);overflow:hidden}
.addr span{padding:0 10px;color:var(--muted);font-size:.9rem;white-space:nowrap}
.addr input{border:0 !important;border-radius:0 !important;background:transparent !important;padding-left:0 !important;padding-right:0 !important;min-width:0;flex:1}
.addr:focus-within{outline:2px solid var(--accent);outline-offset:2px}
#slug-status{margin-top:4px}#slug-status .ok{color:#6ee7b7;background:none;border:0}#slug-status .bad{color:var(--err)}
#slug-status button{background:none;border:1px solid var(--line2);color:var(--fg2);border-radius:999px;padding:2px 10px;margin:4px 6px 0 0;font:inherit;font-size:.85rem;cursor:pointer}
fieldset{border:1px solid var(--line);border-radius:16px;padding:18px 18px 4px;margin:0 0 20px;background:var(--panel)}
legend{font-weight:600;padding:0 6px}
#builder{margin-bottom:32px}
.photos{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}
.photos label{font-weight:400;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.85rem}
.photos img{width:96px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;color:var(--fg2)}
.check input{margin-top:5px;width:18px;height:18px;accent-color:var(--accent)}
.notice{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.ok{background:var(--ok-bg);border-color:var(--ok-line)}
.copybox{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.copybox code{background:rgba(0,0,0,.3);border:1px solid var(--line);border-radius:8px;padding:8px 10px;overflow-wrap:anywhere;flex:1;min-width:0;font-size:.875rem;color:var(--fg)}
footer{border-top:1px solid var(--line);margin-top:48px;padding:32px 0;font-size:.875rem}
footer .links{display:flex;flex-wrap:wrap;gap:8px 20px;padding-bottom:16px}
footer .links a{color:var(--muted);text-decoration:none}footer .links a:hover{color:var(--fg2)}
footer .legal{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;color:var(--dim)}
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
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0}
.tab{background:var(--panel);border:1px solid var(--line);color:var(--fg2);border-radius:999px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}
.tab.active{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.tabpanel{margin-top:8px}.tabpanel.hidden{display:none}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
.tile-n{font-size:2rem;font-weight:800;line-height:1}.tile-l{color:var(--fg2);font-size:.9rem;margin-top:6px}
.tablewrap{overflow-x:auto}
.atable{width:100%;border-collapse:collapse;margin-top:4px;min-width:520px}
.atable th,.atable td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.atable thead th{color:var(--muted);font-size:.85rem;font-weight:600}
.atable .n{text-align:right}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.8rem;font-weight:600}
.badge.live{background:rgba(52,211,153,.15);color:#6ee7b7}.badge.unpublished{background:rgba(255,255,255,.1);color:#d4d4d8}.badge.grace{background:rgba(251,191,36,.15);color:#fcd34d}.badge.paused{background:rgba(248,113,113,.15);color:#fca5a5}
.buttons{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0 4px}
.buttons form{margin:0}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0 0 8px}
dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;color:var(--fg)}
.warn{color:#fcd34d}
.stats{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
table.bars{width:100%;border-collapse:collapse;font-size:.9rem}
table.bars caption{text-align:left;font-weight:600;padding-bottom:6px;color:var(--fg)}
table.bars th,table.bars td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--line);color:var(--fg2);font-weight:400}
table.bars td.n{text-align:right;white-space:nowrap;width:1%}
.bar{display:block;height:8px;border-radius:4px;background:var(--accent);min-width:2px}
</style>
</head>
<body>
<div class="backdrop" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><div class="dots"></div></div>
<header class="top"><div class="wrap">
  <div class="brand"><a class="logo" href="/">Site<span>Vault</span></a><a class="tag" href="https://3pandalabs.com" target="_blank" rel="noopener noreferrer">by 3PandaLabs</a></div>
  <nav class="links">${
    opts.signedIn
      ? `<a class="plain" href="https://advault.3pandalabs.com">Video ads</a>${opts.admin ? `<a class="plain" href="/admin">Admin</a>` : ""}<a class="plain" href="/account">My website</a><a class="btn small" href="/new">Build my website</a><form method="post" action="/logout"><button class="plain" type="submit" style="color:#f87171">Sign out</button></form>`
      : `<a class="btn small" href="/login">Sign in</a>`
  }</nav>
</div></header>
<main id="main" class="wrap">
${opts.body}
</main>
<footer><div class="wrap">
  <div class="links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:${CONTACT}">Contact</a></div>
  <div class="legal"><span>&copy; 3PandaLabs LLC, USA.</span><span>All rights reserved.</span></div>
</div></footer>
${opts.script && opts.nonce ? `<script nonce="${opts.nonce}">${opts.script}</script>` : ""}
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
  return `<div class="plans">
  <div class="included"><h2>Basic</h2><p class="plan-price">${basicPrice}</p><p class="plan-sub">Everything included:</p>${list(INCLUDED)}</div>
  <div class="included pro"><h2>Pro</h2><p class="plan-price">${proPrice}</p><p class="plan-sub">Everything in Basic, plus visitor stats:</p>${list(PRO_EXTRAS)}</div>
</div>
<p class="plan-note" style="margin-bottom:24px">Build it free first. You choose Basic or Pro when you publish, and can upgrade to Pro anytime.</p>`;
}

/** The home page's price line. `festiveUntil`: the festive offer's last day, while it's open. */
function priceLine(billingOn: boolean, festiveUntil: Date | null): string {
  if (!billingOn) return "<b>Free</b> during early access.";
  if (festiveUntil) {
    return `<b>Festive season price: $${DOLLARS.festive}/year and Pro: $${DOLLARS.festivePro}/year</b> (price locked for life). Join before ${esc(fmtDate(festiveUntil))}.<br>After that, $${DOLLARS.basic}/year (Pro $${DOLLARS.pro}).<br>Build it free. Pay only when you publish.`;
  }
  return `<b>$${DOLLARS.basic} a year.</b> Build it free. Pay only when you publish.`;
}

export function homePage(billingOn = false, festiveUntil: Date | null = null, owner = false, signedIn = false): string {
  return layout({
    owner,
    signedIn,
    title: "SiteVault: a website for your business in 5 minutes",
    body: `<section class="hero">
  <span class="pill">Websites for local businesses</span>
  <h1>Your business online in five minutes.</h1>
  <p class="lead">No designer, no tech skills. Tell us what you do, add a few photos, and get a clean, phone-friendly website customers can call you from.</p>
  <p class="price">${priceLine(billingOn, festiveUntil)}</p>
  ${plansBlock(billingOn, festiveUntil !== null)}
  <div style="display:flex;flex-wrap:wrap;gap:12px">${signedIn ? `<a class="btn" href="/account">${owner ? "Go to my website" : "Go to my account"}</a>` : `<a class="btn" href="/login">Sign in to get started</a>`}<a class="btn ghost" href="#features">What you get</a></div>
  <div class="notice" style="margin-top:20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">
    <p style="margin:0;font-size:1.125rem;font-weight:500;line-height:1.5">Want more customers? Get a YouTube video ad, shown to people nearby.<span style="display:block;margin-top:6px;font-size:1rem;font-weight:400;color:var(--fg2)">From your photos, by <a href="https://advault.3pandalabs.com">AdVault</a>. Make your website there and it's $${DOLLARS.advaultSetup} with the first year of Pro included.</span></p>
    <a class="btn" href="https://advault.3pandalabs.com">Make a YouTube ad, $${DOLLARS.advaultAd}</a>
  </div>
  <div class="chips"><span>Landscapers</span><span>Salons</span><span>Plumbers</span><span>Cleaners</span><span>Dentists</span><span>Restaurants</span><span>Realtors</span></div>
</section>
<div class="steps">
  <div class="card"><h3>1. Tell us the basics</h3><p>Name, phone, what you offer, where you work, your hours.</p></div>
  <div class="card"><h3>2. Add photos</h3><p>Your shop, your team, your work. Straight from your phone.</p></div>
  <div class="card"><h3>3. Share your link</h3><p>Put it on Google, your ads, your van, your business cards.</p></div>
</div>
<section id="features">
  <h2>What's on your site</h2>
  <div class="steps">
    <div class="card"><h3>Tap to call and text</h3><p>Big buttons, made for phones, where most customers find you.</p></div>
    <div class="card"><h3>Services and prices</h3><p>Exactly what you offer, in your own words.</p></div>
    <div class="card"><h3>Hours, area, directions</h3><p>Everything a customer checks before they call.</p></div>
    <div class="card"><h3>Fast and private</h3><p>Loads quickly on any phone. No cookies, no trackers.</p></div>
  </div>
</section>`,
  });
}

export type FormMode =
  | { kind: "new"; account?: { email: string } | null }
  | { kind: "edit"; site: Site; key: string; photoUrl: (k: string) => string; billing?: BillingView; visitors?: VisitorsView; signedIn?: boolean };

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

function payButton(slug: string, key: string, kind: CheckoutKind, label: string, ghost = false): string {
  return `<form method="post" action="/api/billing/checkout"><input type="hidden" name="key" value="${esc(key)}"><input type="hidden" name="slug" value="${esc(slug)}"><input type="hidden" name="kind" value="${kind}"><button class="btn${ghost ? " ghost" : ""}" type="submit">${esc(label)}</button></form>`;
}

/** Buttons to publish a SiteVault-made site (done page and edit page). */
function publishButtons(slug: string, key: string, prices: BillingView["prices"]): string {
  const festive = prices.festive ? `<p class="hint">Festive season prices (price locked for life): Basic $${prices.basic}/year (normally $${DOLLARS.basic}), Pro $${prices.pro}/year (normally $${DOLLARS.pro}).</p>` : "";
  return `${festive}<div class="buttons">${
    prices.basic !== null ? payButton(slug, key, "publish_basic", `Publish: $${prices.basic}/year`) : ""
  }${payButton(slug, key, "publish_pro", `Publish with Pro: $${prices.pro}/year`, prices.basic !== null)}</div>`;
}

/** Days before the paid time ends when renewing opens. */
export const RENEW_WINDOW_DAYS = 45;

export function billingSection(slug: string, key: string, v: BillingView): string {
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
    status = `<p>Your website isn't published yet. Finish in AdVault: pay $${DOLLARS.advaultSetup} (the first year of Pro included) on your campaign's website card, and it goes live at once.</p>`;
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
    buttons.push(publishButtons(slug, key, v.prices));
  } else {
    // Paying again only makes sense near the end of the paid time (or after it):
    // a site paid until next year must not be asked to pay now.
    const now = v.now ?? new Date();
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
    if (plans.length) buttons.push(`<div class="buttons">${plans.join("")}</div>`);
    if (!b.renewing && !renewOpen && v.paidUntil) {
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

export function visitorsSection(v: VisitorsView): string {
  const s = v.stats;
  if (!s) return "";
  const total = `<p><strong>${s.total}</strong> visit${s.total === 1 ? "" : "s"} in the last 30 days.</p>`;
  const vt = `${s.total} visit${s.total === 1 ? "" : "s"} in the last 30 days`;
  if (!v.full) {
    return `<details class="section"><summary>Visitors <span class="sum">— ${vt}</span></summary><div class="section-body">${total}<p>Upgrade to Pro to see where visitors come from, which days are busiest, and how many tap to call.</p></div></details>`;
  }
  const place = (p: { city: string; country: string }) => [p.city, p.country].filter(Boolean).join(", ") || "Unknown";
  const tables = [
    barTable("Where visitors came from", "Source", s.sources.map((r) => ({ label: SOURCE_LABELS[r.source] ?? r.source, n: Number(r.views) }))),
    barTable("Where visitors are", "Place", s.places.map((r) => ({ label: place(r), n: Number(r.views) }))),
    barTable("Devices", "Device", s.devices.map((r) => ({ label: r.device.charAt(0).toUpperCase() + r.device.slice(1), n: Number(r.views) }))),
    barTable("Visits by day", "Day", s.days.map((r) => ({ label: fmtDate(new Date(`${r.day}T00:00:00Z`)), n: Number(r.views) }))),
  ].filter(Boolean);
  return `<details class="section"><summary>Visitors <span class="sum">— ${vt}</span></summary><div class="section-body">${total}
  <dl class="facts"><dt>Taps to call</dt><dd>${s.taps.calls}</dd><dt>Taps for directions</dt><dd>${s.taps.directions}</dd></dl>
  ${tables.length ? `<div class="stats">${tables.join("")}</div>` : ""}
  <p class="hint">Counted without cookies and without storing anyone's IP address. Taps are counted by browsers that support it, so the real number can be higher.</p></div></details>`;
}

const FIELD_ORDER = [
  "businessName",
  "slug",
  "category",
  "phone",
  "email",
  "city",
  "address",
  "serviceArea",
  "tagline",
  "offer",
  "services",
  "hours",
  "about",
  "photos",
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
export function advaultOfferLink(site: Pick<Site, "slug" | "source">): string {
  const style = ` style="display:inline-block;padding:12px 0;min-height:44px"`;
  return site.source === "advault"
    ? `<a${style} href="${esc(`${ADVAULT_ORIGIN}/dashboard?siteOffer=${encodeURIComponent(site.slug)}`)}">Also run this offer as a YouTube ad with AdVault →</a>`
    : `<a${style} href="${esc(ADVAULT_ORIGIN)}">Turn this offer into a video ad</a>`;
}

export function builderPage(
  mode: FormMode,
  nonce: string,
  errors: FieldErrors = {},
  values: Record<string, string> = {},
  domain: string | null = null,
): string {
  const site = mode.kind === "edit" ? mode.site : null;
  const v = (k: string, fallback = "") => esc(values[k] ?? fallback);
  const e = (k: string) => `<div class="err" id="err-${k}" role="alert">${esc(errors[k] ?? "")}</div>`;
  const action = mode.kind === "edit" ? `/api/sites/${encodeURIComponent(mode.site.slug)}` : "/api/sites";
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
      ? `<p class="hint">Current photos. Untick any you want to remove. The first photo is the big one at the top.</p>
<div class="photos">${mode.site.photos
          .map(
            (k, i) =>
              `<label><img src="${esc(mode.photoUrl(k))}" alt="Photo ${i + 1}"><span><input type="checkbox" name="keep" value="${esc(k)}" checked> Keep</span></label>`,
          )
          .join("")}</div>`
      : "";

  const body = `<section>
<h1>${mode.kind === "edit" ? "Edit your website" : "Build your website"}</h1>
<p class="lead">${mode.kind === "edit" ? `Changes go live as soon as you save.` : "Takes about five minutes. Only the first three fields are required; everything else makes your site better."}</p>
<form id="builder" method="post" action="${action}" enctype="multipart/form-data" novalidate>
${mode.kind === "edit" ? `<input type="hidden" name="key" value="${esc(mode.key)}">` : ""}
<fieldset><legend>Your business</legend>
  <div class="field"><label for="businessName">Business name</label><input type="text" id="businessName" name="businessName" maxlength="80" required value="${v("businessName", site?.businessName)}" autocomplete="organization">${e("businessName")}</div>
  ${addressField}
  <div class="row">
    <div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="phone" maxlength="24" required value="${v("phone", site?.phone)}" autocomplete="tel" placeholder="(201) 555-0100">${e("phone")}</div>
    <div class="field"><label for="city">Town or city <span class="hint">Needed unless you add a street address below.</span></label><input type="text" id="city" name="city" maxlength="60" value="${v("city", site?.city)}" placeholder="Secaucus, NJ">${e("city")}</div>
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
    <div class="field"><label for="serviceArea">Areas you serve <span class="hint">Optional</span></label><input type="text" id="serviceArea" name="serviceArea" maxlength="160" value="${v("serviceArea", site?.serviceArea ?? "")}" placeholder="Secaucus, Hoboken, Jersey City">${e("serviceArea")}</div>
  </div>
</fieldset>
<fieldset><legend>What you offer</legend>
  <div class="field"><label for="tagline">One line about you <span class="hint">Optional. Shown under your name.</span></label><input type="text" id="tagline" name="tagline" maxlength="120" value="${v("tagline", site?.tagline)}" placeholder="Family-owned lawn care since 2009">${e("tagline")}</div>
  <div class="field"><label for="offer">Current special <span class="hint">Optional. Shown in a banner.${
    mode.kind === "edit" && mode.billing
      ? ` Changing it uses 1 credit (${mode.billing.billing.credits} left). Clearing it is free.`
      : ""
  }</span></label><input type="text" id="offer" name="offer" maxlength="160" value="${v("offer", site?.offer ?? "")}" placeholder="Spring cleanup from $149, this month only">${e("offer")}${mode.kind === "edit" ? advaultOfferLink(mode.site) : ""}</div>
  <div class="field"><label for="services">Services and prices <span class="hint">Optional. One per line, price after a dash.</span></label><textarea id="services" name="services" placeholder="Lawn mowing - from $35&#10;Spring cleanup - $149&#10;Hedge trimming">${v("services", site ? servicesToText(site.services) : "")}</textarea>${e("services")}</div>
  <div class="field"><label for="hours">Opening hours <span class="hint">Optional</span></label><textarea id="hours" name="hours" placeholder="Mon-Fri 8am-6pm&#10;Sat 9am-2pm&#10;Sun closed">${v("hours", site?.hours ?? "")}</textarea>${e("hours")}</div>
  <div class="field"><label for="about">About your business <span class="hint">Optional. A few sentences in your own words.</span></label><textarea id="about" name="about" maxlength="1200">${v("about", site?.about)}</textarea>${e("about")}</div>
</fieldset>
<fieldset><legend>Photos</legend>
  ${mode.kind === "edit" && mode.site.video ? `<label class="check"><input type="checkbox" name="keepVideo" value="yes" checked> <span>Keep the video ad on my website</span></label>` : ""}
  ${existing}
  <div class="field"><label for="photos">Add photos <span class="hint">Up to ${MAX_PHOTOS} in total. JPG, PNG or WebP. Use photos you took or have the right to use.</span></label><input type="file" id="photos" name="photos" accept="image/jpeg,image/png,image/webp" multiple>${e("photos")}</div>
</fieldset>
${mode.kind === "new" ? accountFields(mode.account ?? null, v, e) : ""}
<div class="field"><label class="check"><input type="checkbox" name="attest" value="yes" required${mode.kind === "edit" ? " checked" : ""}> <span>I own or run this business (or have its permission), the details are accurate, and I agree to the <a href="/terms" target="_blank">Terms</a>.</span></label>${e("attest")}</div>
<div class="err" id="err-form" role="alert">${esc(errors.form ?? "")}</div>
<div class="buttons">
  <button class="btn" type="submit" id="submit">${mode.kind === "edit" ? "Save changes" : "Create my website"}</button>
  ${mode.kind === "edit" ? `<a class="btn ghost" href="/edit/${encodeURIComponent(mode.site.slug)}?k=${encodeURIComponent(mode.key)}">Cancel</a>` : ""}
</div>
</form>
${mode.kind === "edit" && mode.visitors ? visitorsSection(mode.visitors) : ""}
${mode.kind === "edit" && mode.billing ? billingSection(mode.site.slug, mode.key, mode.billing) : ""}
${
  mode.kind === "edit"
    ? `<div style="margin-top:28px" class="notice">
  <p><strong>Want your website taken down?</strong> Email <a href="mailto:3pandas@3pandalabs.com?subject=${encodeURIComponent(`Remove my website: ${mode.site.slug}`)}">3pandas@3pandalabs.com</a> with your web address. We'll confirm with you at the phone number on your site, cancel any renewal, and remove it.</p>
</div>`
    : ""
}
</section>`;

  return layout({
    title: mode.kind === "edit" ? "Edit your website | SiteVault" : "Build your website | SiteVault",
    body,
    nonce,
    owner: mode.kind === "edit",
    signedIn: mode.kind === "new" ? Boolean(mode.account) : Boolean(mode.signedIn),
    noindex: mode.kind === "edit",
    script: BUILDER_SCRIPT,
  });
}

// Shrinks photos client-side, posts with fetch, shows field errors inline.
// Falls back to the normal multipart post when anything here is unsupported.
const BUILDER_SCRIPT = `
(function(){
  var form=document.getElementById('builder'); if(!form||!window.fetch||!window.FormData) return;
  var FIELDS=${JSON.stringify(FIELD_ORDER)};
  // Prefill "Services and prices" from the chosen business type. Only replaces
  // an empty box or an untouched earlier suggestion, so typed content is kept
  // (including if you just tab past it).
  var SERVICE_TEMPLATES=${JSON.stringify(SERVICE_TEMPLATES)};
  var svc=document.getElementById('services'), catSel=document.getElementById('category');
  if(svc && catSel){
    var lastFill='';
    var fillServices=function(){
      var t=SERVICE_TEMPLATES[catSel.value]||'';
      if(t && (svc.value.trim()==='' || svc.value===lastFill)){ svc.value=t; lastFill=t; }
    };
    catSel.addEventListener('change',fillServices);
    if(svc.value.trim()==='') fillServices();
  }
  // Opening hours: offer a weekly template to edit; it stays once touched, and
  // an existing site's hours are never overwritten.
  var HOURS_TEMPLATE=${JSON.stringify(HOURS_TEMPLATE)};
  var hrs=document.getElementById('hours');
  if(hrs){
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
    if(slug.value) check();
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
  form.addEventListener('submit', function(ev){
    ev.preventDefault();
    var btn=document.getElementById('submit'); btn.disabled=true; var label=btn.textContent; btn.textContent='Working…';
    FIELDS.concat(['form']).forEach(function(f){ var el=document.getElementById('err-'+f); if(el) el.textContent=''; });
    var fd=new FormData(form); var files=fd.getAll('photos').filter(function(f){ return f && f.size; }); fd.delete('photos');
    Promise.all(files.map(shrink)).then(function(small){
      small.forEach(function(f){ fd.append('photos', f); });
      return fetch(form.action,{method:'POST',body:fd,headers:{accept:'application/json'}});
    }).then(function(r){ return r.json().catch(function(){ return {ok:false,errors:{form:'Something went wrong. Please try again.'}}; }); })
    .then(function(res){
      if(res.ok){ window.location.href=res.next; return; }
      var first=null;
      Object.keys(res.errors||{}).forEach(function(k){ var el=document.getElementById('err-'+k)||document.getElementById('err-form'); el.textContent=res.errors[k]; if(!first) first=el; });
      if(first) first.scrollIntoView({behavior:'smooth',block:'center'});
      btn.disabled=false; btn.textContent=label;
    }).catch(function(){ document.getElementById('err-form').textContent='Could not reach SiteVault. Check your connection and try again.'; btn.disabled=false; btn.textContent=label; });
  });
})();`;

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
  ${publishButtons(pub.slug, pub.key, pub.prices)}
</div>`
    : "";
  return layout({
    title: pub ? "Your website is ready | SiteVault" : "Your website is live | SiteVault",
    noindex: true,
    signedIn: opts.signedIn,
    admin: opts.admin,
    nonce: opts.nonce,
    script: `document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied';});});});`,
    body: `<section>
<h1>${pub ? "Your website is ready" : "Your website is live 🎉"}</h1>
<div class="notice ok">
  <p><strong>Your website</strong></p>
  <div class="copybox"><code>${esc(opts.siteUrl)}</code><button class="btn ghost" type="button" data-copy="${esc(opts.siteUrl)}">Copy</button><a class="btn" href="${esc(opts.siteUrl)}" target="_blank">Open</a></div>
</div>
<div class="notice" style="margin-top:16px">
  <p><strong>Your private edit link. Save it now.</strong> It's the only way to change your site. Anyone with it can edit, so don't share it. Bookmark this page or email the link to yourself.</p>
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
export function authPage(kind: "login" | "signup", opts: { error?: string; email?: string; next?: string } = {}): string {
  const login = kind === "login";
  const next = opts.next && /^\/[a-z0-9/_?=&-]*$/i.test(opts.next) ? opts.next : "/account";
  return layout({
    title: `${login ? "Sign in" : "Create your account"} | SiteVault`,
    noindex: true,
    body: `<section class="narrow" style="max-width:440px">
<h1>${login ? "Sign in" : "Create your account"}</h1>
${opts.error ? `<p class="notice warn" role="alert">${esc(opts.error)}</p>` : ""}
<form method="post" action="/${login ? "login" : "signup"}">
  <input type="hidden" name="next" value="${esc(next)}">
  <div class="field"><label for="email">Email</label><input type="email" id="email" name="email" autocomplete="email" required maxlength="200" value="${esc(opts.email ?? "")}"></div>
  <div class="field"><label for="password">Password${login ? "" : ` <span class="hint">At least 10 characters</span>`}</label><input type="password" id="password" name="password" autocomplete="${login ? "current-password" : "new-password"}" required minlength="${login ? 1 : 10}" maxlength="200"></div>
  <button class="btn" type="submit">${login ? "Sign in" : "Create account"}</button>
</form>
<p class="hint" style="margin-top:20px">${
      login
        ? `<strong>One 3PandaLabs login:</strong> the same email and password work on SiteVault and <a href="https://advault.3pandalabs.com">AdVault</a>, whichever you signed up on.<br>New here? <a href="/signup">Create an account</a> or <a href="/new">build your website</a>. Forgot your password? Email <a href="mailto:3pandas@3pandalabs.com">3pandas@3pandalabs.com</a>.`
        : `This is your 3PandaLabs account: it also signs you in to <a href="https://advault.3pandalabs.com">AdVault</a>. Already have one (from SiteVault or AdVault)? <a href="/login">Sign in</a>.`
    }</p>
</section>`,
  });
}

export type AccountSite = { slug: string; name: string; siteUrl: string; state: string };

/** "My websites": every site on the account, and a way to add one made before accounts. */
export function accountPage(
  email: string,
  sites: AccountSite[],
  opts: { claimError?: string; claimed?: boolean; admin?: boolean } = {},
): string {
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
        .map(
          (s) => `<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 4px">${esc(s.name)}</h3>
  <p class="hint" style="margin:0 0 10px"><a href="${esc(s.siteUrl)}" target="_blank" rel="noopener">${esc(s.siteUrl)}</a> · ${esc(STATE[s.state] ?? s.state)}</p>
  <div class="buttons"><a class="btn" href="/edit/${esc(s.slug)}">Edit, billing and visitors</a><a class="btn ghost" href="${esc(s.siteUrl)}" target="_blank" rel="noopener">View</a></div></div>`,
        )
        .join("")
    : `<p>No website on this account yet. <a href="/new">Build it</a>, or add one you already made below.</p>`;
  return layout({
    title: "My website | SiteVault",
    noindex: true,
    owner: sites.length > 0,
    signedIn: true,
    admin: opts.admin,
    body: `<section>
<h1>${opts.admin ? "My websites" : "My website"}</h1>
<p class="hint">Signed in as ${esc(email)}${opts.admin ? " · admin (unlimited websites, published free)" : ""}</p>
${opts.admin ? `<div class="buttons"><a class="btn" href="/admin">Admin dashboard</a></div>` : ""}
${opts.claimed ? `<p class="notice ok" role="status">Added to your account.</p>` : ""}
${rows}
${footer}
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
    title: "Admin | SiteVault",
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

export function messagePage(title: string, message: string, status = "Not found"): string {
  return layout({
    title: `${title} | SiteVault`,
    noindex: true,
    body: `<section class="hero"><span class="pill">${esc(status)}</span><h1>${esc(title)}</h1><p class="lead">${esc(message)}</p><a class="btn" href="/">Go to SiteVault</a></section>`,
  });
}

export function privacyPage(): string {
  return layout({
    title: "Privacy | SiteVault",
    body: `<section class="prose">
<h1>Privacy</h1>
<p>Last updated 16 November 2026. SiteVault is run by 3PandaLabs LLC, a New Jersey company. Contact: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<h2>What we store</h2>
<ul>
  <li><strong>The details you enter</strong> (business name, phone, email, address, services, hours and text) and <strong>the photos you upload</strong>. These are published on your website, which is public. Photos are resized for the web.</li>
  <li>If your site was made from <a href="https://advault.3pandalabs.com">AdVault</a>: your business name, offer, ad photos and <strong>your video ad</strong>, which AdVault sends us when you press "Make me a website".</li>
  <li><strong>A scrambled copy of your private edit key</strong>, so we can check it without storing the key itself.</li>
  <li><strong>Your account is one 3PandaLabs account, shared with <a href="https://advault.3pandalabs.com">AdVault</a></strong> (our video-ad app, also by 3PandaLabs): the same email and password sign you in to both, whichever you signed up on. Your sign-in (email and a scrambled, hashed copy of your password, which can't be turned back into the password) is stored by AdVault for both apps; when you sign in here we send AdVault the email and password you typed to check them. SiteVault stores your email, your 3PandaLabs account ID and which websites are yours. Accounts made on SiteVault before 16 November 2026 kept their hashed password here; it moves to the shared account the next time you sign in. While you're signed in we keep a session record that expires after 30 days or when you sign out.</li>
  <li><strong>Which apps you use</strong>: with your account we record which app you created it on (SiteVault or AdVault) and when you first used each one (your first website here, your first ad campaign in AdVault), so we know whether you use SiteVault, AdVault or both and can offer benefits that depend on it, for example to customers who use only SiteVault.</li>
  <li><strong>A short-lived counter per network address</strong> to limit how many sites can be created in a day. It expires after about a day.</li>
  <li><strong>Visit counts for each website, in total only</strong>: per day, the number of visits and of taps on the call and directions buttons, grouped by rough location (country and city, as worked out by Cloudflare), device type (phone, tablet or computer) and where visitors came from (for example YouTube, Google or a typed-in address). We don't store visitors' IP addresses, the full address of the page they came from, or their browser details, and we keep no record of any individual visitor. The business owner sees these totals on their edit page.</li>
  <li><strong>If you pay for a plan</strong>: payments are handled by Stripe, which processes your card details; we never see or store them. We store the Stripe customer and subscription IDs for your website and the email address Stripe gives us for the payer, plus your plan, paid-until date and offer credits.</li>
</ul>
<h2>What we don't do</h2>
<ul>
  <li>No advertising trackers or third-party analytics on SiteVault or on the websites it makes. Visit counts are kept by SiteVault itself, as described above.</li>
  <li>One cookie only, and only when you sign in: a sign-in cookie on sitevault.3pandalabs.com that keeps you signed in. The websites we make (on 3pandasite.com) never set or read cookies.</li>
  <li>We don't sell or share your details. They're shown on your website because you asked us to publish them.</li>
</ul>
<h2>Where it's kept</h2>
<p>Sites, photos and visit counts are stored and served by Cloudflare, our hosting provider, in its global network. Visitors' browsers connect to Cloudflare to load your site, as with any website. Payment records are kept by Stripe.</p>
<h2>Your choices</h2>
<p>Change anything at any time with your edit link. Your 3PandaLabs account can be deleted in AdVault (Settings, Delete account) or by emailing us; that ends your sign-in on both apps but doesn't remove your website. To have your website removed, email 3pandas@3pandalabs.com with your web address: we confirm with you at the phone number on the site, then take it offline and delete its photos. If you've lost your edit link, email us too and we'll help.</p>
<h2>Children</h2>
<p>SiteVault is for businesses and is not directed at children under 13.</p>
</section>`,
  });
}

export function termsPage(): string {
  return layout({
    title: "Terms | SiteVault",
    body: `<section class="prose">
<h1>Terms</h1>
<p>Last updated 16 November 2026. These terms are between you and 3PandaLabs LLC (New Jersey), which runs SiteVault.</p>
<h2>Your account</h2>
<p>Your SiteVault account is a single 3PandaLabs account shared with AdVault: the same email and password sign you in to both, whichever you created it on, and it is stored by AdVault. Keep your password to yourself; you're responsible for what's done with your account. Deleting the account ends your sign-in on both apps. Each app's own terms apply to what you do in it, and SiteVault plans are billed separately from AdVault.</p>
<h2>Your content</h2>
<p>You must own or run the business, or have its permission. Everything you publish must be true and lawful, and you must have the right to use every photo. You keep ownership of your content and give us permission to host and display it on your website.</p>
<h2>Not allowed</h2>
<p>Impersonating another business, misleading claims or prices, collecting passwords or payments, illegal goods or services, adult content, hate, or anything that breaks the law. Links to other websites can't be added to page text. We may remove any site that breaks these rules, without notice.</p>
<h2>Real estate</h2>
<p>Housing-related sites must follow US fair-housing law, including not stating preferences based on protected characteristics.</p>
<h2>Price</h2>
<p>Prices are in US dollars:</p>
<ul>
  <li><strong>Websites made on SiteVault</strong>: free to build; you pay when you publish. Basic is $49 a year to keep the site running; Pro is $89 a year and adds visitor stats.</li>
  <li><strong>Festive season prices</strong>: a plan paid on or before January 31, 2027 is $29 a year for Basic or $59 a year for Pro, and the site keeps these prices for life, including if it switches between Basic and Pro or pays again after a lapse.</li>
  <li><strong>Websites made from AdVault</strong>: $10 one-time, paid in AdVault, which includes the first year of Pro; then Pro at $49 a year.</li>
  <li><strong>Offer credits</strong>: every site starts with 2. Changing your current special uses 1 credit; clearing it is free. Extra credits are $10 for 5.</li>
</ul>
<p>Plans are billed yearly and renew automatically until you cancel; cancelling stops the next renewal and your site stays up until the end of the paid year. A site made during early access stays free until January 31, 2027. If a payment isn't made, the site stays online for 14 days, then shows a "paused" page with your business name and phone number. We never delete a paused site; paying brings it back. Payments are processed by Stripe. Sites are billed separately from any AdVault plan. You can have your site removed at any time by emailing 3pandas@3pandalabs.com; we cancel its renewal at the same time.</p>
<h2>No guarantee</h2>
<p>SiteVault is provided as is. We work to keep sites online but don't guarantee uninterrupted service. To the extent the law allows, our liability is limited to the amount you've paid us in the last 12 months.</p>
<h2>Law</h2>
<p>These terms are governed by the laws of New Jersey, USA.</p>
</section>`,
  });
}
