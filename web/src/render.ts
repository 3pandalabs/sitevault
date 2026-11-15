// The customer's public site. One accessible template, coloured per business
// type. Plain HTML + inline CSS, no JavaScript, no web fonts, no maps embed,
// no trackers: it loads fast on a phone, sets no cookies, and has nothing on
// it the business didn't type.
//
// Accessibility is a requirement, not polish: US small-business sites are a
// common target of ADA website lawsuits. Semantic landmarks, real headings,
// alt text, visible focus, 4.5:1 contrast (every brand colour in CATEGORIES is
// dark enough for white text), and nothing that only works with a mouse.

import { CATEGORIES, headline, type Site } from "./site.js";
import { esc, jsonForScript, mapsHref, smsHref, telHref } from "./util.js";

export type RenderContext = {
  /** Absolute URL this site is served at (canonical). */
  siteUrl: string;
  /** Origin that serves photos, e.g. https://sitevault.3pandalabs.com */
  assetOrigin: string;
  /** SiteVault's own home page, for the footer credit. */
  homeUrl: string;
};

export function photoUrl(ctx: RenderContext, key: string): string {
  return `${ctx.assetOrigin}/p/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function renderSite(site: Site, ctx: RenderContext): string {
  const cat = CATEGORIES[site.category];
  const brand = cat.brand;
  const title = `${site.businessName} | ${cat.label} in ${site.city}`;
  const description = (site.about || headline(site)).slice(0, 160);
  const photos = site.photos.map((k) => photoUrl(ctx, k));
  const hero = photos[0];
  const gallery = photos.slice(1);
  const where = [site.address, site.city].filter(Boolean).join(", ");
  const realEstate = site.category === "realestate";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: site.businessName,
    telephone: site.phone,
    ...(site.email ? { email: site.email } : {}),
    address: site.address
      ? { "@type": "PostalAddress", streetAddress: site.address, addressLocality: site.city }
      : { "@type": "PostalAddress", addressLocality: site.city },
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
<meta name="theme-color" content="${brand}">
<script type="application/ld+json">${jsonForScript(jsonLd)}</script>
<style>
:root{--brand:${brand};--ink:#111827;--muted:#4b5563;--line:#e5e7eb;--bg:#ffffff;--band:#f9fafb}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
a{color:var(--brand)}
a:focus-visible,.btn:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;background:#fff;padding:8px;z-index:9}
header.top{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:5}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;padding-bottom:10px}
.name{font-weight:800;font-size:1.1rem;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none;border:2px solid var(--brand)}
.btn.primary{background:var(--brand);color:#fff}
.btn.ghost{background:#fff;color:var(--brand)}
.hero{position:relative;background:var(--brand);color:#fff}
.hero img{display:block;width:100%;height:min(56vh,460px);object-fit:cover}
.hero .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.05),rgba(0,0,0,.65))}
.hero .copy{position:absolute;left:0;right:0;bottom:0;padding:24px 0}
.hero.noimg .copy{position:static;padding:56px 0}
.hero h1{margin:0 0 6px;font-size:clamp(1.7rem,5vw,2.6rem);line-height:1.15}
.hero p{margin:0;font-size:1.1rem;opacity:.95}
.offer{background:#fef3c7;color:#78350f;font-weight:700;text-align:center;padding:12px 16px}
.actions{display:flex;flex-wrap:wrap;gap:10px;padding:20px 0}
section{padding:36px 0}
section.band{background:var(--band);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
h2{font-size:1.5rem;margin:0 0 16px}
.services{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.services li{display:flex;justify-content:space-between;gap:12px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.svc{font-weight:600}.price{color:var(--muted);white-space:nowrap}
.gallery{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.gallery img{width:100%;height:200px;object-fit:cover;border-radius:10px;display:block}
.facts{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.facts h3{margin:0 0 4px;font-size:1rem}
.facts p{margin:0;white-space:pre-line;color:var(--muted)}
footer{padding:28px 0 40px;color:var(--muted);font-size:.9rem;border-top:1px solid var(--line)}
footer a{color:var(--muted)}
.callbar{position:fixed;left:0;right:0;bottom:0;display:none;gap:8px;padding:10px 16px;background:#fff;border-top:1px solid var(--line)}
.callbar .btn{flex:1}
@media (max-width:640px){.callbar{display:flex}body{padding-bottom:72px}header.top .btn{display:none}}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="name" href="${esc(ctx.siteUrl)}">${esc(site.businessName)}</a>
    <a class="btn primary" href="${esc(telHref(site.phone))}">Call ${esc(site.phone)}</a>
  </div>
</header>
<main id="main">
<div class="hero${hero ? "" : " noimg"}">
  ${hero ? `<img src="${esc(hero)}" alt="${esc(site.businessName)}" fetchpriority="high">\n  <div class="shade"></div>` : ""}
  <div class="copy"><div class="wrap">
    <h1>${esc(site.businessName)}</h1>
    <p>${esc(headline(site))}</p>
  </div></div>
</div>
${site.offer ? `<p class="offer">${esc(site.offer)}</p>` : ""}
<div class="wrap actions">
  <a class="btn primary" href="${esc(telHref(site.phone))}">Call now</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">Send a text</a>
  ${site.email ? `<a class="btn ghost" href="mailto:${esc(site.email)}">Email us</a>` : ""}
  ${where ? `<a class="btn ghost" href="${esc(mapsHref(`${site.businessName} ${where}`))}" rel="noopener">Get directions</a>` : ""}
</div>
${services}
${about}
${galleryHtml}
<section aria-labelledby="contact-h">
  <div class="wrap">
    <h2 id="contact-h">Contact</h2>
    <div class="facts">
      <div><h3>Phone</h3><p><a href="${esc(telHref(site.phone))}">${esc(site.phone)}</a></p></div>
      ${site.email ? `<div><h3>Email</h3><p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p></div>` : ""}
      ${where ? `<div><h3>Location</h3><p>${esc(where)}</p></div>` : ""}
      ${site.serviceArea ? `<div><h3>Areas we serve</h3><p>${esc(site.serviceArea)}</p></div>` : ""}
      ${site.hours ? `<div><h3>Hours</h3><p>${esc(site.hours)}</p></div>` : ""}
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
  <a class="btn primary" href="${esc(telHref(site.phone))}">Call</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">Text</a>
</nav>
</body>
</html>`;
}
