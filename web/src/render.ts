// The customer's public site. Static templates, coloured per business type.
// Plain HTML + inline CSS, no web fonts, no maps embed, no trackers, no
// cookies: it loads fast on a phone and has nothing on it the business didn't
// type. One small FIRST-PARTY inline script (nonce'd, no network, no external
// code) adds motion: scroll reveals, a hero ken-burns and a gallery lightbox.
// It is progressive — everything works with JS off — and respects
// prefers-reduced-motion. The template (spotlight/split/editorial) only
// changes the hero layout, typography and spacing — every section is shared.
//
// Accessibility is a requirement, not polish: US small-business sites are a
// common target of ADA website lawsuits. Semantic landmarks, real headings,
// alt text, visible focus, 4.5:1 contrast (every theme's primary is dark
// enough for white text), and nothing that only works with a mouse.

import { CATEGORIES, headline, type Site } from "./site.js";
import { asTemplate, isTemplate, themeFor, type TemplateKey, type Theme } from "./templates.js";
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
  /** Preview a style without saving (from `?style=`): overrides site.template for this view only. */
  previewTemplate?: string;
  /** CSP nonce; when set, the motion script is included (customer sites). */
  nonce?: string;
};

// First-party, no-network motion for customer sites. Progressive: adds `.js` to
// <html> so reveal styles only apply when this runs; honours reduced motion.
const SITE_JS = `(function(){
  var d=document,root=d.documentElement,w=window;root.className+=(root.className?' ':'')+'js';
  var reduce=w.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rev=[].slice.call(d.querySelectorAll('.reveal'));
  if(reduce||!('IntersectionObserver' in w)){rev.forEach(function(e){e.classList.add('in');});}
  else{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px',threshold:.08});rev.forEach(function(e){io.observe(e);});}
  var hdr=d.querySelector('header.top');
  var pb=d.createElement('div');pb.className='progress';d.body.appendChild(pb);
  var tt=d.createElement('button');tt.type='button';tt.className='totop';tt.setAttribute('aria-label','Back to top');tt.innerHTML='\\u2191';d.body.appendChild(tt);
  tt.addEventListener('click',function(){w.scrollTo({top:0,behavior:reduce?'auto':'smooth'});});
  var onScroll=function(){var st=w.scrollY||w.pageYOffset,h=d.documentElement.scrollHeight-w.innerHeight;pb.style.width=(h>0?Math.min(100,st/h*100):0)+'%';tt.classList.toggle('show',st>600);if(hdr)hdr.classList.toggle('scrolled',st>8);};
  w.addEventListener('scroll',onScroll,{passive:true});onScroll();
  var imgs=[].slice.call(d.querySelectorAll('.gallery img'));
  if(imgs.length){
    var box=d.createElement('div');box.className='lightbox';box.hidden=true;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','Photo');
    var big=d.createElement('img');big.alt='';
    var prev=d.createElement('button');prev.type='button';prev.className='lb-nav lb-prev';prev.setAttribute('aria-label','Previous photo');prev.innerHTML='\\u2039';
    var next=d.createElement('button');next.type='button';next.className='lb-nav lb-next';next.setAttribute('aria-label','Next photo');next.innerHTML='\\u203a';
    box.appendChild(big);box.appendChild(prev);box.appendChild(next);d.body.appendChild(box);
    var idx=0,show=function(i){idx=(i+imgs.length)%imgs.length;big.src=imgs[idx].currentSrc||imgs[idx].src;big.alt=imgs[idx].alt;};
    var open=function(i){show(i);box.hidden=false;requestAnimationFrame(function(){box.classList.add('open');});};
    var close=function(){box.classList.remove('open');setTimeout(function(){box.hidden=true;big.removeAttribute('src');},240);};
    imgs.forEach(function(im,i){im.addEventListener('click',function(){open(i);});});
    prev.addEventListener('click',function(e){e.stopPropagation();show(idx-1);});
    next.addEventListener('click',function(e){e.stopPropagation();show(idx+1);});
    box.addEventListener('click',function(e){if(e.target===box||e.target===big)close();});
    w.addEventListener('keydown',function(e){if(box.hidden)return;if(e.key==='Escape')close();else if(e.key==='ArrowLeft')show(idx-1);else if(e.key==='ArrowRight')show(idx+1);});
  }
})();`;

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

// Inline, decorative line icons (no external requests; aria-hidden).
const ICONS: Record<string, string> = {
  phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  chat: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  mail: `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/>`,
  pin: `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  clock: `<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`,
};
const icon = (n: keyof typeof ICONS) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true">${ICONS[n]}</svg>`;

/** The hero, per template. `headline` may be empty; `eyebrow` is the category. */
function buildHero(
  template: TemplateKey,
  o: { eyebrow: string; name: string; headline: string; hero?: string; phone: string; pingCall: string },
): string {
  const eyebrow = `<p class="eyebrow">${esc(o.eyebrow)}</p>`;
  const h1 = `<h1>${esc(o.name)}</h1>`;
  const p = o.headline ? `<p class="lede">${esc(o.headline)}</p>` : "";
  if (template === "split") {
    const cta = `<a class="btn primary hero-cta" href="${esc(telHref(o.phone))}"${o.pingCall}>Call ${esc(o.phone)}</a>`;
    return `<div class="hero split${o.hero ? "" : " noimg"}">
  <div class="hero-text">${eyebrow}${h1}${p}${cta}</div>
  ${o.hero ? `<div class="hero-img">${heroImg(o.hero, o.name)}</div>` : ""}
</div>`;
  }
  if (template === "editorial") {
    return `<div class="hero editorial"><div class="wrap">${eyebrow}${h1}${p}</div></div>
${o.hero ? `<div class="hero-band">${heroImg(o.hero, o.name)}</div>` : ""}`;
  }
  return `<div class="hero spotlight${o.hero ? "" : " noimg"}">
  ${o.hero ? `${heroImg(o.hero, o.name)}\n  <div class="shade"></div>` : ""}
  <div class="copy"><div class="wrap">${eyebrow}${h1}${p}</div></div>
</div>`;
}

/** Shared CSS, driven by the theme's custom properties. */
const baseCss = (t: Theme) => `:root{--primary:${t.primary};--accent:${t.accent};--ink:${t.ink};--muted:${t.muted};--line:${t.line};--bg:${t.bg};--band:${t.band};--card:${t.card};--head-font:${t.headFont};--radius:${t.radius};--btn-radius:${t.btnRadius};--section-pad:${t.pad};--reveal-dur:${t.revealDur};--head-weight:${t.headWeight};--head-spacing:${t.headSpacing}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--body-font,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px}
.wrap{max-width:960px;margin:0 auto;padding:0 16px}
a{color:var(--primary)}
a:focus-visible,.btn:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;background:#fff;padding:8px;z-index:9}
.eyebrow{margin:0 0 10px;font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.kicker{margin:0 0 8px;font-size:.78rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--primary)}
.ic{flex:none;vertical-align:-3px}
.reveal{transition:opacity var(--reveal-dur) ease,transform var(--reveal-dur) ease}
:root.js .reveal{opacity:0;transform:translateY(22px)}
:root.js .reveal.in{opacity:1;transform:none}
header.top.scrolled{box-shadow:0 6px 24px rgba(15,23,42,.10)}
.lightbox{position:fixed;inset:0;background:rgba(5,8,12,.92);display:flex;align-items:center;justify-content:center;padding:24px;z-index:60;cursor:zoom-out}
.lightbox[hidden]{display:none}
.lightbox img{max-width:100%;max-height:100%;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.gallery img{cursor:zoom-in}
@media(prefers-reduced-motion:no-preference){.hero.spotlight img,.hero.split .hero-img img,.hero-band img{animation:kenburns 20s ease-out both}}
@keyframes kenburns{from{transform:scale(1.08)}to{transform:scale(1)}}
.hero.spotlight,.hero.split .hero-img{overflow:hidden}
:root.js .reveal .services li,:root.js .reveal .gallery li{opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .5s ease}
:root.js .reveal.in .services li,:root.js .reveal.in .gallery li{opacity:1;transform:none}
.reveal.in .services li:nth-child(2),.reveal.in .gallery li:nth-child(2){transition-delay:.06s}
.reveal.in .services li:nth-child(3),.reveal.in .gallery li:nth-child(3){transition-delay:.12s}
.reveal.in .services li:nth-child(4),.reveal.in .gallery li:nth-child(4){transition-delay:.18s}
.reveal.in .services li:nth-child(5),.reveal.in .gallery li:nth-child(5){transition-delay:.24s}
.reveal.in .services li:nth-child(n+6),.reveal.in .gallery li:nth-child(n+6){transition-delay:.3s}
:root.js .reveal h2::after{width:0;transition:width .6s ease .15s}
:root.js .reveal.in h2::after{width:48px}
:root.js .t-editorial .reveal.in h2::after{width:56px}
.gallery li{overflow:hidden;border-radius:var(--radius)}
.gallery li img{transition:transform .5s ease}
.gallery li:hover img{transform:scale(1.06)}
.btn{position:relative;overflow:hidden}
.btn.primary::after{content:"";position:absolute;top:0;left:-70%;width:45%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);transform:skewX(-18deg);transition:left .6s ease;pointer-events:none}
.btn.primary:hover::after{left:130%}
.progress{position:fixed;top:0;left:0;height:3px;width:0;background:var(--accent);z-index:70;transition:width .08s linear}
.totop{position:fixed;right:16px;bottom:88px;width:48px;height:48px;border-radius:50%;background:var(--primary);color:#fff;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.3rem;opacity:0;transform:translateY(10px) scale(.92);pointer-events:none;transition:opacity .25s,transform .25s;z-index:45;box-shadow:0 8px 24px rgba(0,0,0,.28)}
.totop.show{opacity:1;transform:none;pointer-events:auto}
.lightbox{opacity:0;transition:opacity .24s ease}
.lightbox.open{opacity:1}
.lightbox .lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,.16);border:0;color:#fff;cursor:pointer;font-size:1.6rem;line-height:1;display:flex;align-items:center;justify-content:center}
.lightbox .lb-nav:hover{background:rgba(255,255,255,.28)}
.lightbox .lb-prev{left:14px}.lightbox .lb-next{right:14px}
@media(prefers-reduced-motion:reduce){:root.js .reveal{opacity:1;transform:none;transition:none}:root.js .reveal .services li,:root.js .reveal .gallery li{opacity:1;transform:none;transition:none}:root.js .reveal h2::after{width:48px;transition:none}.gallery li:hover img{transform:none}.btn.primary::after{display:none}.totop{transition:none}}
header.top{border-bottom:1px solid var(--line);background:var(--card);background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:saturate(1.3) blur(8px);position:sticky;top:0;z-index:5}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;padding-bottom:12px}
.name{font-weight:800;font-size:1.1rem;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:46px;padding:11px 20px;border-radius:var(--btn-radius);font-weight:700;text-decoration:none;border:2px solid var(--primary);transition:transform .12s ease,box-shadow .12s ease,background .12s ease}
.btn.primary{background:var(--primary);background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 82%,#000));color:#fff;box-shadow:0 2px 6px rgba(15,23,42,.18)}
.btn.primary:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(15,23,42,.26)}
.btn.ghost{background:var(--card);color:var(--primary)}
.btn.ghost:hover{background:var(--band)}
.offer{background:#fef3c7;color:#78350f;font-weight:700;text-align:center;padding:14px 16px;border-bottom:3px solid var(--accent)}
.actions{display:flex;flex-wrap:wrap;gap:12px;padding:24px 0}
section{padding:var(--section-pad) 0}
section.band{background:var(--band);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
h2{font-family:var(--head-font,inherit);font-weight:var(--head-weight,700);letter-spacing:var(--head-spacing,-.005em);font-size:1.6rem;margin:0 0 20px;position:relative;padding-bottom:14px}
h2::after{content:"";position:absolute;left:0;bottom:0;width:48px;height:3px;background:var(--accent);border-radius:2px}
.services{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.services li{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;box-shadow:0 1px 3px rgba(15,23,42,.05);transition:transform .12s ease,box-shadow .12s ease}
.services li:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,23,42,.09)}
.svc{font-weight:600}.price{color:var(--primary);font-weight:700;white-space:nowrap}
.gallery{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.gallery img{width:100%;height:220px;object-fit:cover;border-radius:var(--radius);display:block}
.ba{list-style:none;margin:0;padding:0;display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.ba-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ba figure{margin:0;position:relative}
.ba img{width:100%;aspect-ratio:4/3;height:auto;object-fit:cover;border-radius:var(--radius);display:block;background:var(--band)}
.ba figcaption{position:absolute;left:8px;top:8px;background:rgba(15,23,42,.82);color:#fff;font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px}
.ba figure.after figcaption{background:var(--primary)}
video.ad{display:block;width:100%;max-height:70vh;border-radius:12px;background:#000}
.facts{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.facts h3{margin:0 0 4px;font-size:1rem;display:flex;align-items:center;gap:8px}
.facts h3 .ic{color:var(--primary)}
.facts p{margin:0;white-space:pre-line;color:var(--muted)}
.visit{display:grid;gap:28px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));align-items:start}
.visit-col h2{margin:0 0 4px;font-size:1.3rem;padding-bottom:10px}
.visit-sub{margin:0 0 12px;color:var(--muted);font-size:.88rem}
.visit-addr{font-style:normal;margin:0 0 14px;color:var(--ink);font-size:.95rem}
.schedule{width:100%;border-collapse:separate;border-spacing:0 3px}
.schedule th,.schedule td{padding:7px 13px;font-size:.88rem}
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
.hero.spotlight img{display:block;width:100%;height:min(66vh,540px);object-fit:cover}
.hero.spotlight .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.12) 0%,rgba(0,0,0,.34) 45%,rgba(0,0,0,.80) 100%)}
.hero.spotlight .copy{position:absolute;left:0;right:0;bottom:0;padding:40px 0}
.hero.spotlight.noimg{background:var(--primary);background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 68%,#000))}
.hero.spotlight.noimg .copy{position:static;padding:72px 0}
.hero.spotlight .eyebrow{display:inline-block;color:#fff;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);padding:6px 14px;border-radius:999px;backdrop-filter:blur(4px)}
.hero.spotlight h1{font-family:var(--head-font);margin:14px 0 10px;font-size:clamp(2rem,6vw,3.3rem);line-height:1.08;letter-spacing:-.015em;text-shadow:0 2px 14px rgba(0,0,0,.35)}
.hero.spotlight .lede{margin:0;font-size:1.2rem;max-width:46ch;opacity:.96}`,
  split: `.hero.split{display:grid;grid-template-columns:1.05fr .95fr;background:var(--primary);background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 78%,#000));color:#fff;align-items:stretch}
.hero.split .hero-text{padding:52px clamp(18px,5vw,60px);align-self:center}
.hero.split .eyebrow{color:rgba(255,255,255,.82)}
.hero.split h1{font-family:var(--head-font);margin:0 0 12px;font-size:clamp(1.9rem,4.4vw,2.8rem);line-height:1.12;letter-spacing:-.01em}
.hero.split .lede{margin:0 0 24px;font-size:1.15rem;opacity:.95;max-width:40ch}
.hero.split .hero-cta{background:#fff;color:var(--primary);border-color:#fff}
.hero.split .hero-cta:hover{background:var(--band)}
.hero.split .hero-img{clip-path:polygon(7% 0,100% 0,100% 100%,0% 100%)}
.hero.split .hero-img img{display:block;width:100%;height:100%;min-height:300px;object-fit:cover}
.hero.split.noimg{display:block}
@media(max-width:720px){.hero.split{grid-template-columns:1fr}.hero.split .hero-img{clip-path:none}.hero.split .hero-img img{min-height:240px}}`,
  editorial: `:root{--head-font:Georgia,Cambria,"Times New Roman",serif}
.hero.editorial{background:var(--band);color:var(--ink);text-align:center;padding:72px 0 56px;border-bottom:1px solid var(--line)}
.hero.editorial .eyebrow{color:var(--primary)}
.hero.editorial h1{font-family:var(--head-font);margin:0 0 14px;font-size:clamp(2.2rem,6.4vw,3.4rem);line-height:1.08;letter-spacing:-.015em}
.hero.editorial .lede{margin:0 auto;max-width:44ch;color:var(--muted);font-size:1.2rem}
.hero.editorial .eyebrow::before,.hero.editorial .eyebrow::after{content:"";display:inline-block;width:30px;height:1px;background:var(--primary);opacity:.55;vertical-align:middle;margin:0 12px}
.hero-band{padding:44px 16px;background:var(--band)}
.hero-band img{display:block;width:100%;max-width:960px;margin:0 auto;height:min(54vh,460px);object-fit:cover;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.14)}
.t-editorial .kicker{text-align:center}
.t-editorial .kicker::before,.t-editorial .kicker::after{content:"";display:inline-block;width:26px;height:1px;background:var(--accent);vertical-align:middle;margin:0 10px}
.t-editorial h2{text-align:center;padding-bottom:16px}
.t-editorial h2::after{left:50%;transform:translateX(-50%);width:56px}
.t-editorial .services{max-width:720px;margin:0 auto}
.t-editorial .services li{background:transparent;border:0;border-bottom:1px solid var(--line);border-radius:0;box-shadow:none;padding:16px 4px}
.t-editorial .services li:hover{transform:none;box-shadow:none}
.t-editorial .facts{text-align:center}
.t-editorial .facts h3{justify-content:center}
.t-editorial section[aria-labelledby="about-h"] p:first-of-type::first-letter{float:left;font-family:var(--head-font);font-size:3.4em;line-height:.72;padding:6px 10px 0 0;color:var(--primary)}`,
};

export function renderSite(site: Site, ctx: RenderContext): string {
  const cat = CATEGORIES[site.category];
  const brand = cat.brand;
  const template = isTemplate(ctx.previewTemplate) ? ctx.previewTemplate : asTemplate(site.template);
  const theme = themeFor(site.category, brand);
  const title = `${site.businessName} | ${cat.label}${site.city ? ` in ${site.city}` : ""}`;
  const description = (site.about || headline(site)).slice(0, 160);
  const photos = site.photos.map((k) => photoUrl(ctx, k));
  // The owner chooses whether the first photo is the big hero banner. If not,
  // a coloured banner shows and every photo goes to the gallery instead.
  const useHeroPhoto = site.heroPhoto && photos.length > 0;
  const hero = useHeroPhoto ? photos[0] : undefined;
  const gallery = useHeroPhoto ? photos.slice(1) : photos;
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
    ? `<section aria-labelledby="services-h" class="band reveal">
  <div class="wrap">
    <p class="kicker">What we offer</p>
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
    ? `<section aria-labelledby="about-h" class="reveal">
  <div class="wrap">
    <p class="kicker">Our story</p>
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
      ? `<section aria-label="Location and hours" class="band reveal">
  <div class="wrap visit">
    ${locationBlock}
    ${hoursBlock}
  </div>
</section>`
      : "";

  const video = site.video
    ? `<section aria-labelledby="video-h" class="reveal">
  <div class="wrap">
    <h2 id="video-h">See us in action</h2>
    <video class="ad" controls playsinline preload="metadata"${hero ? ` poster="${esc(hero)}"` : ""} aria-label="${esc(`${site.businessName} video`)}">
      <source src="${esc(photoUrl(ctx, site.video))}" type="video/mp4">
    </video>
  </div>
</section>`
    : "";

  const galleryHtml = gallery.length
    ? `<section aria-labelledby="gallery-h" class="band reveal">
  <div class="wrap">
    <p class="kicker">Recent work</p>
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

  const pairs = site.beforeAfter ?? [];
  const beforeAfterHtml = pairs.length
    ? `<section aria-labelledby="ba-h" class="reveal">
  <div class="wrap">
    <p class="kicker">Real jobs</p>
    <h2 id="ba-h">Before &amp; after</h2>
    <ul class="ba">
      ${pairs
        .map(
          (p, i) =>
            `<li><div class="ba-pair"><figure class="before"><img src="${esc(photoUrl(ctx, p.before))}" alt="${esc(`Before: ${site.businessName} job ${i + 1}`)}" loading="lazy" decoding="async"><figcaption>Before</figcaption></figure><figure class="after"><img src="${esc(photoUrl(ctx, p.after))}" alt="${esc(`After: ${site.businessName} job ${i + 1}`)}" loading="lazy" decoding="async"><figcaption>After</figcaption></figure></div></li>`,
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
${ctx.nonce ? `<script nonce="${ctx.nonce}">document.documentElement.className+=' js'</script>` : ""}
</head>
<body class="t-${template}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="name" href="${esc(ctx.siteUrl)}">${esc(site.businessName)}</a>
    <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>${icon("phone")}Call ${esc(site.phone)}</a>
  </div>
</header>
<main id="main">
${buildHero(template, { eyebrow: cat.label, name: site.businessName, headline: headline(site), hero, phone: site.phone, pingCall: ping("call") })}
${site.offer ? `<p class="offer">${esc(site.offer)}</p>` : ""}
<div class="wrap actions">
  <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>${icon("phone")}Call now</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">${icon("chat")}Send a text</a>
  ${site.email ? `<a class="btn ghost" href="mailto:${esc(site.email)}">${icon("mail")}Email us</a>` : ""}
  ${where ? `<a class="btn ghost" href="${esc(mapsHref(`${site.businessName} ${where}`))}" rel="noopener"${ping("directions")}>${icon("pin")}Get directions</a>` : ""}
</div>
${video}
${services}
${about}
${galleryHtml}
${beforeAfterHtml}
${visit}
<section aria-labelledby="contact-h" class="reveal">
  <div class="wrap">
    <p class="kicker">Get in touch</p>
    <h2 id="contact-h">Contact</h2>
    <div class="facts">
      <div><h3>${icon("phone")}Phone</h3><p><a href="${esc(telHref(site.phone))}"${ping("call")}>${esc(site.phone)}</a></p></div>
      ${site.email ? `<div><h3>${icon("mail")}Email</h3><p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p></div>` : ""}
      ${site.serviceArea ? `<div><h3>${icon("pin")}Areas we serve</h3><p>${esc(site.serviceArea)}</p></div>` : ""}
    </div>
  </div>
</section>
</main>
<footer>
  <div class="wrap">
    <p>&copy; ${new Date().getUTCFullYear()} ${esc(site.businessName)}.${realEstate ? " Equal Housing Opportunity." : ""}</p>
    <p>Website by <a href="${esc(ctx.homeUrl)}">SiteVault</a> from 3PandaLabs.</p>
  </div>
</footer>
<nav class="callbar" aria-label="Quick contact">
  <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>Call</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">Text</a>
</nav>
${ctx.nonce ? `<script nonce="${ctx.nonce}">${SITE_JS}</script>` : ""}
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
