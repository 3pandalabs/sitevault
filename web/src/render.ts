// The customer's public site. Static templates, coloured per business type.
// Plain HTML + inline CSS, no JavaScript, no web fonts, no maps embed, no
// trackers: it loads fast on a phone, sets no cookies, and has nothing on it
// the business didn't type. The template (spotlight/split/editorial) only
// changes the hero layout, typography and spacing — every section is shared.
//
// Accessibility is a requirement, not polish: US small-business sites are a
// common target of ADA website lawsuits. Semantic landmarks, real headings,
// alt text, visible focus, 4.5:1 contrast (every theme's primary is dark
// enough for white text), and nothing that only works with a mouse.

import { CATEGORIES, headline, type Site } from "./site.js";
import { asTemplate, themeFor, type TemplateKey, type Theme } from "./templates.js";
import { esc, jsonForScript, mapsHref, smsHref, telHref } from "./util.js";

export type RenderContext = {
  /** Absolute URL this site is served at (canonical). */
  siteUrl: string;
  /** Origin that serves photos, e.g. https://sitevault.3pandalabs.com */
  assetOrigin: string;
  /** SiteVault's own home page, for the footer credit. */
  homeUrl: string;
  /**
   * Count call/directions taps with the HTML ping attribute (no JavaScript):
   * the browser POSTs to /t/<kind> on the site's own host. Only on the
   * customer-site subdomain, where /t/ is routed.
   */
  ping?: boolean;
};

export function photoUrl(ctx: RenderContext, key: string): string {
  return `${ctx.assetOrigin}/p/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// A weekday at the START of a line, including ranges: "Mon", "Monday",
// "Mon-Fri", "Monday - Friday", "Mon, Wed, Fri".
const DAYWORD = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
const DAY_HEADING = new RegExp(`^${DAYWORD}(?:\\s*(?:-|–|—|to|&|,|and)\\s*${DAYWORD})*`, "i");

/**
 * Pair each day with its hours, however the owner typed the free-text field:
 * "Monday: 10am-7pm", "Mon 10am-7pm", or the day and the time on two separate
 * lines. A line with no recognisable day is treated as the previous day's time
 * (so a day on its own line picks up the time below it), or shown full width.
 */
function parseHours(raw: string): { day: string; time: string }[] {
  const rows: { day: string; time: string }[] = [];
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(DAY_HEADING);
    // A real heading: the match isn't run into more letters ("Sunflower" is not "Sun").
    if (m && !/^[a-z]/i.test(line.slice(m[0].length))) {
      rows.push({ day: m[0], time: line.slice(m[0].length).replace(/^[\s:–—-]+/, "").trim() });
    } else if (rows.length && !rows[rows.length - 1]!.time) {
      rows[rows.length - 1]!.time = line;
    } else {
      rows.push({ day: "", time: line });
    }
  }
  return rows;
}

const heroImg = (src: string, alt: string) => `<img src="${esc(src)}" alt="${esc(alt)}" fetchpriority="high">`;

/** The hero, per template. `headline` may be empty. */
function buildHero(template: TemplateKey, o: { name: string; headline: string; hero?: string }): string {
  const h1 = `<h1>${esc(o.name)}</h1>`;
  const p = o.headline ? `<p>${esc(o.headline)}</p>` : "";
  if (template === "split") {
    return `<div class="hero split${o.hero ? "" : " noimg"}">
  <div class="hero-text">${h1}${p}</div>
  ${o.hero ? `<div class="hero-img">${heroImg(o.hero, o.name)}</div>` : ""}
</div>`;
  }
  if (template === "editorial") {
    return `<div class="hero editorial"><div class="wrap">${h1}${p}</div></div>
${o.hero ? `<div class="hero-band">${heroImg(o.hero, o.name)}</div>` : ""}`;
  }
  return `<div class="hero spotlight${o.hero ? "" : " noimg"}">
  ${o.hero ? `${heroImg(o.hero, o.name)}\n  <div class="shade"></div>` : ""}
  <div class="copy"><div class="wrap">${h1}${p}</div></div>
</div>`;
}

/** Shared CSS, driven by the theme's custom properties. */
const baseCss = (t: Theme) => `:root{--primary:${t.primary};--accent:${t.accent};--ink:${t.ink};--muted:${t.muted};--line:${t.line};--bg:${t.bg};--band:${t.band};--card:${t.card}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--body-font,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
a{color:var(--primary)}
a:focus-visible,.btn:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;background:#fff;padding:8px;z-index:9}
header.top{border-bottom:1px solid var(--line);background:var(--card);position:sticky;top:0;z-index:5}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;padding-bottom:10px}
.name{font-weight:800;font-size:1.1rem;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none;border:2px solid var(--primary)}
.btn.primary{background:var(--primary);color:#fff}
.btn.ghost{background:var(--card);color:var(--primary)}
.offer{background:#fef3c7;color:#78350f;font-weight:700;text-align:center;padding:12px 16px}
.actions{display:flex;flex-wrap:wrap;gap:10px;padding:20px 0}
section{padding:36px 0}
section.band{background:var(--band);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
h2{font-family:var(--head-font,inherit);font-size:1.5rem;margin:0 0 16px}
.services{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.services li{display:flex;justify-content:space-between;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.svc{font-weight:600}.price{color:var(--muted);white-space:nowrap}
.gallery{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.gallery img{width:100%;height:200px;object-fit:cover;border-radius:10px;display:block}
video.ad{display:block;width:100%;max-height:70vh;border-radius:12px;background:#000}
.facts{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.facts h3{margin:0 0 4px;font-size:1rem}
.facts p{margin:0;white-space:pre-line;color:var(--muted)}
.visit{display:grid;gap:32px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));align-items:start}
.visit-col h2{margin:0 0 4px}
.visit-sub{margin:0 0 16px;color:var(--muted)}
.visit-addr{font-style:normal;margin:0 0 16px;color:var(--ink);font-size:1.05rem}
.schedule{width:100%;border-collapse:separate;border-spacing:0 4px}
.schedule th,.schedule td{padding:12px 16px;font-size:1rem}
.schedule th{background:var(--primary);color:#fff;text-align:left;font-weight:700;width:42%;white-space:nowrap;border-radius:6px}
.schedule td{text-align:center;color:var(--ink);background:var(--card);border:1px solid var(--line);border-left:0;border-radius:0 6px 6px 0}
.visit-note{text-align:center;color:var(--muted);font-weight:600;background:var(--band);border-radius:6px}
footer{padding:28px 0 40px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line)}
footer a{color:var(--muted)}
.callbar{position:fixed;left:0;right:0;bottom:0;display:none;gap:8px;padding:10px 16px;background:var(--card);border-top:1px solid var(--line)}
.callbar .btn{flex:1}
@media (max-width:640px){.callbar{display:flex}body{padding-bottom:72px}header.top .btn{display:none}}`;

const TEMPLATE_CSS: Record<TemplateKey, string> = {
  spotlight: `.hero.spotlight{position:relative;background:var(--primary);color:#fff}
.hero.spotlight img{display:block;width:100%;height:min(56vh,460px);object-fit:cover}
.hero.spotlight .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.65))}
.hero.spotlight .copy{position:absolute;left:0;right:0;bottom:0;padding:24px 0}
.hero.spotlight.noimg .copy{position:static;padding:56px 0}
.hero.spotlight h1{font-family:var(--head-font);margin:0 0 6px;font-size:clamp(1.7rem,5vw,2.6rem);line-height:1.15}
.hero.spotlight p{margin:0;font-size:1.1rem;opacity:.95}`,
  split: `.hero.split{display:grid;grid-template-columns:1.05fr .95fr;background:var(--primary);color:#fff;align-items:stretch}
.hero.split .hero-text{padding:44px clamp(16px,5vw,56px);align-self:center}
.hero.split h1{font-family:var(--head-font);margin:0 0 10px;font-size:clamp(1.7rem,4.2vw,2.5rem);line-height:1.15}
.hero.split p{margin:0;font-size:1.1rem;opacity:.95}
.hero.split .hero-img img{display:block;width:100%;height:100%;min-height:260px;object-fit:cover}
.hero.split.noimg{display:block}
@media(max-width:720px){.hero.split{grid-template-columns:1fr}.hero.split .hero-img img{min-height:220px}}`,
  editorial: `:root{--head-font:Georgia,Cambria,"Times New Roman",serif}
.hero.editorial{background:var(--band);color:var(--ink);text-align:center;padding:64px 0 48px;border-bottom:1px solid var(--line)}
.hero.editorial h1{font-family:var(--head-font);margin:0 0 12px;font-size:clamp(2rem,6vw,3rem);line-height:1.1;letter-spacing:-.01em}
.hero.editorial p{margin:0 auto;max-width:42ch;color:var(--muted);font-size:1.15rem}
.hero-band img{display:block;width:100%;height:min(50vh,420px);object-fit:cover}`,
};

export function renderSite(site: Site, ctx: RenderContext): string {
  const cat = CATEGORIES[site.category];
  const brand = cat.brand;
  const template = asTemplate(site.template);
  const theme = themeFor(site.category, brand);
  const title = `${site.businessName} | ${cat.label}${site.city ? ` in ${site.city}` : ""}`;
  const description = (site.about || headline(site)).slice(0, 160);
  const photos = site.photos.map((k) => photoUrl(ctx, k));
  const hero = photos[0];
  const gallery = photos.slice(1);
  const where = [site.address, site.city].filter(Boolean).join(", ");
  const realEstate = site.category === "realestate";
  const ping = (kind: "call" | "directions") => (ctx.ping ? ` ping="/t/${kind}"` : "");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: site.businessName,
    telephone: site.phone,
    ...(site.email ? { email: site.email } : {}),
    address: {
      "@type": "PostalAddress",
      ...(site.address ? { streetAddress: site.address } : {}),
      ...(site.city ? { addressLocality: site.city } : {}),
    },
    ...(site.serviceArea ? { areaServed: site.serviceArea } : {}),
    ...(hero ? { image: hero } : {}),
    url: ctx.siteUrl,
  };

  const services = site.services.length
    ? `<section aria-labelledby="services-h" class="band">
  <div class="wrap">
    <h2 id="services-h">Services</h2>
    <ul class="services">
      ${site.services
        .map(
          (s) =>
            `<li><span class="svc">${esc(s.name)}</span>${s.price ? `<span class="price">${esc(s.price)}</span>` : ""}</li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : "";

  const about = site.about
    ? `<section aria-labelledby="about-h">
  <div class="wrap">
    <h2 id="about-h">About us</h2>
    ${site.about
      .split(/\n{2,}/)
      .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
      .join("\n    ")}
  </div>
</section>`
    : "";

  // "Our Location" + "Hours of Operation". Hours are free text, one line per day
  // ("Monday: 10am-7pm" or "Mon-Fri 8am-6pm"); each line becomes a day label plus
  // its time. No map embed (CSP forbids it): location is the address + a link.
  const locationBlock = where
    ? `<div class="visit-col">
        <h2>Our Location</h2>
        <p class="visit-sub">Find us on the map</p>
        <address class="visit-addr">${esc(where)}</address>
        <a class="btn ghost" href="${esc(mapsHref(`${site.businessName} ${where}`))}" rel="noopener"${ping("directions")}>Get directions</a>
      </div>`
    : "";
  const hoursBlock = site.hours
    ? `<div class="visit-col">
        <h2>Hours of Operation</h2>
        <p class="visit-sub">Our Regular Schedule</p>
        <table class="schedule"><tbody>
          ${parseHours(site.hours)
            .map((r) =>
              r.day
                ? `<tr><th scope="row">${esc(r.day)}:</th><td>${esc(r.time || "—")}</td></tr>`
                : `<tr><td colspan="2" class="visit-note">${esc(r.time)}</td></tr>`,
            )
            .join("\n          ")}
        </tbody></table>
      </div>`
    : "";
  const visit =
    locationBlock || hoursBlock
      ? `<section aria-label="Location and hours" class="band">
  <div class="wrap visit">
    ${locationBlock}
    ${hoursBlock}
  </div>
</section>`
      : "";

  const video = site.video
    ? `<section aria-labelledby="video-h">
  <div class="wrap">
    <h2 id="video-h">See us in action</h2>
    <video class="ad" controls playsinline preload="metadata"${hero ? ` poster="${esc(hero)}"` : ""} aria-label="${esc(`${site.businessName} video`)}">
      <source src="${esc(photoUrl(ctx, site.video))}" type="video/mp4">
    </video>
  </div>
</section>`
    : "";

  const galleryHtml = gallery.length
    ? `<section aria-labelledby="gallery-h" class="band">
  <div class="wrap">
    <h2 id="gallery-h">Our work</h2>
    <ul class="gallery">
      ${gallery
        .map(
          (src, i) =>
            `<li><img src="${esc(src)}" alt="${esc(`${site.businessName}, photo ${i + 2}`)}" loading="lazy" decoding="async"></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(ctx.siteUrl)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(site.businessName)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(ctx.siteUrl)}">
${hero ? `<meta property="og:image" content="${esc(hero)}">` : ""}
<meta name="theme-color" content="${theme.primary}">
<script type="application/ld+json">${jsonForScript(jsonLd)}</script>
<style>
${baseCss(theme)}
${TEMPLATE_CSS[template]}
</style>
</head>
<body class="t-${template}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="name" href="${esc(ctx.siteUrl)}">${esc(site.businessName)}</a>
    <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>Call ${esc(site.phone)}</a>
  </div>
</header>
<main id="main">
${buildHero(template, { name: site.businessName, headline: headline(site), hero })}
${site.offer ? `<p class="offer">${esc(site.offer)}</p>` : ""}
<div class="wrap actions">
  <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>Call now</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">Send a text</a>
  ${site.email ? `<a class="btn ghost" href="mailto:${esc(site.email)}">Email us</a>` : ""}
  ${where ? `<a class="btn ghost" href="${esc(mapsHref(`${site.businessName} ${where}`))}" rel="noopener"${ping("directions")}>Get directions</a>` : ""}
</div>
${video}
${services}
${about}
${galleryHtml}
${visit}
<section aria-labelledby="contact-h">
  <div class="wrap">
    <h2 id="contact-h">Contact</h2>
    <div class="facts">
      <div><h3>Phone</h3><p><a href="${esc(telHref(site.phone))}"${ping("call")}>${esc(site.phone)}</a></p></div>
      ${site.email ? `<div><h3>Email</h3><p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p></div>` : ""}
      ${site.serviceArea ? `<div><h3>Areas we serve</h3><p>${esc(site.serviceArea)}</p></div>` : ""}
    </div>
  </div>
</section>
</main>
<footer>
  <div class="wrap">
    <p>&copy; ${new Date().getUTCFullYear()} ${esc(site.businessName)}.${realEstate ? " Equal Housing Opportunity." : ""}</p>
    <p>Website by <a href="${esc(ctx.homeUrl)}">SiteVault</a> from 3PandaLabs. This page sets no cookies. <a href="mailto:3pandas@3pandalabs.com?subject=${encodeURIComponent(`Report site ${site.slug}`)}">Report this page</a></p>
  </div>
</footer>
<nav class="callbar" aria-label="Quick contact">
  <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>Call</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">Text</a>
</nav>
</body>
</html>`;
}

/**
 * What a visitor sees instead of the site: "paused" (unpaid past the grace
 * period: still shows the business name and phone, so a customer can call)
 * or "unpublished" (made on SiteVault, not paid for yet). Same light look as
 * customer sites, no JavaScript, not indexed.
 */
export function renderHold(site: Site, kind: "paused" | "unpublished"): string {
  const brand = CATEGORIES[site.category].brand;
  const title = kind === "paused" ? `${site.businessName}: this site is paused` : "This site isn't published yet";
  const body =
    kind === "paused"
      ? `<h1>${esc(site.businessName)}</h1>
    <p>This site is paused.</p>
    <p><a class="btn" href="${esc(telHref(site.phone))}">Call ${esc(site.phone)}</a></p>`
      : `<h1>This site isn't published yet</h1>
    <p>Check back soon.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111827;background:#fff;line-height:1.6;font-size:17px}
main{max-width:640px;margin:0 auto;padding:64px 16px;text-align:center}
h1{font-size:clamp(1.6rem,5vw,2.2rem);line-height:1.2;margin:0 0 12px}
p{color:#4b5563}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none;background:${brand};color:#fff}
.btn:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
</style>
</head>
<body>
<main id="main">
    ${body}
</main>
</body>
</html>`;
}
