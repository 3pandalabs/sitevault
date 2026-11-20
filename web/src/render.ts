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

import { CATEGORIES, headline, insuranceAllowed, isMenuPdf, listingsAllowed, menuAllowed, reviewStats, scheduleAllowed, teamAllowed, type PolicyKind, type Site } from "./site.js";
import { POLICY_KINDS, POLICY_META, policyBody, renderPolicyMarkup } from "./policies.js";
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
export const SITE_JS = `(function(){
  var d=document,root=d.documentElement,w=window;root.className+=(root.className?' ':'')+'js';
  var reduce=w.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rev=[].slice.call(d.querySelectorAll('.reveal'));
  if(reduce||!('IntersectionObserver' in w)){rev.forEach(function(e){e.classList.add('in');});}
  else{var io=new IntersectionObserver(function(es){es.forEach(function(e){e.target.classList.toggle('in',e.isIntersecting);});},{rootMargin:'0px 0px -8% 0px',threshold:.08});rev.forEach(function(e){io.observe(e);});}
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
  var cmps=[].slice.call(d.querySelectorAll('.ba-cmp'));
  if(cmps.length){
    var pbox=d.createElement('div');pbox.className='lightbox pairbox';pbox.hidden=true;pbox.setAttribute('role','dialog');pbox.setAttribute('aria-modal','true');pbox.setAttribute('aria-label','Before and after, side by side');
    var prow=d.createElement('div');prow.className='pairrow';pbox.appendChild(prow);d.body.appendChild(pbox);
    var pclose=function(){pbox.classList.remove('open');setTimeout(function(){pbox.hidden=true;while(prow.firstChild)prow.removeChild(prow.firstChild);},240);};
    var fig=function(img,lab){var f=d.createElement('figure');f.className='pairfig';var im=d.createElement('img');im.src=img.currentSrc||img.src;im.alt=img.alt;var cap=d.createElement('figcaption');cap.textContent=lab;f.appendChild(im);f.appendChild(cap);return f;};
    var popen=function(b,a){while(prow.firstChild)prow.removeChild(prow.firstChild);prow.appendChild(fig(b,'Before'));prow.appendChild(fig(a,'After'));pbox.hidden=false;requestAnimationFrame(function(){pbox.classList.add('open');});};
    pbox.addEventListener('click',function(e){if(e.target===pbox||e.target===prow||e.target.tagName==='IMG')pclose();});
    w.addEventListener('keydown',function(e){if(!pbox.hidden&&e.key==='Escape')pclose();});
    cmps.forEach(function(c){
      var div=c.querySelector('.ba-divider');if(!div)return;
      var setPct=function(p){p=Math.max(0,Math.min(100,p));c.style.setProperty('--pos',p+'%');div.setAttribute('aria-valuenow',Math.round(p));};
      var setX=function(x){var r=c.getBoundingClientRect();setPct((x-r.left)/r.width*100);};
      var moving=false,dragged=false;
      var move=function(e){if(!moving)return;e.preventDefault();dragged=true;setX(e.touches?e.touches[0].clientX:e.clientX);};
      var down=function(e){moving=true;dragged=false;e.preventDefault();setX(e.touches?e.touches[0].clientX:e.clientX);};
      div.addEventListener('mousedown',down);div.addEventListener('touchstart',down,{passive:false});
      w.addEventListener('mousemove',move,{passive:false});w.addEventListener('touchmove',move,{passive:false});
      w.addEventListener('mouseup',function(){moving=false;});w.addEventListener('touchend',function(){moving=false;});
      div.addEventListener('keydown',function(e){var cur=parseFloat(c.style.getPropertyValue('--pos'))||50;if(e.key==='ArrowLeft'){setPct(cur-5);e.preventDefault();}else if(e.key==='ArrowRight'){setPct(cur+5);e.preventDefault();}});
      c.addEventListener('click',function(e){if(e.target.closest('.ba-divider'))return;if(dragged){dragged=false;return;}var bi=c.querySelector('.ba-reveal img'),ai=c.querySelector('.ba-base');if(bi&&ai)popen(bi,ai);});
    });
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
  // Category label intentionally not shown in the hero (owner's name leads).
  const eyebrow = "";
  void o.eyebrow;
  const h1 = `<h1>${esc(o.name)}</h1>`;
  const p = o.headline ? `<p class="lede">${esc(o.headline)}</p>` : "";
  // The same photo, softly blurred, fills the banner behind the sharp (contained) one.
  const bg = o.hero ? ` style="--photo:url('${o.hero}')"` : "";
  if (template === "split") {
    const cta = `<a class="btn primary hero-cta" href="${esc(telHref(o.phone))}"${o.pingCall}>Call ${esc(o.phone)}</a>`;
    return `<div class="hero split${o.hero ? "" : " noimg"}">
  <div class="hero-text">${eyebrow}${h1}${p}${cta}</div>
  ${o.hero ? `<div class="hero-img"${bg}>${heroImg(o.hero, o.name)}</div>` : ""}
</div>`;
  }
  if (template === "editorial") {
    return `<div class="hero editorial"><div class="wrap">${eyebrow}${h1}${p}</div></div>
${o.hero ? `<div class="hero-band"${bg}>${heroImg(o.hero, o.name)}</div>` : ""}`;
  }
  return `<div class="hero spotlight${o.hero ? "" : " noimg"}"${bg}>
  ${o.hero ? `${heroImg(o.hero, o.name)}\n  <div class="shade"></div>` : ""}
  <div class="copy"><div class="wrap">${eyebrow}${h1}${p}</div></div>
</div>`;
}

/** Shared CSS, driven by the theme's custom properties. */
const baseCss = (t: Theme) => `:root{--primary:${t.primary};--accent:${t.accent};--ink:${t.ink};--muted:${t.muted};--line:${t.line};--bg:${t.bg};--band:${t.band};--card:${t.card};--head-font:${t.headFont};--radius:${t.radius};--btn-radius:${t.btnRadius};--section-pad:${t.pad};--reveal-dur:${t.revealDur};--head-weight:${t.headWeight};--head-spacing:${t.headSpacing}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--body-font,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px;overflow-x:hidden}
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
/* Directional reveals: a section slides in from the left or the right, a touch
   slower than the default reveal so the motion reads clearly. */
:root.js .reveal.from-left:not(.in){transform:translateX(-46px)}
:root.js .reveal.from-right:not(.in){transform:translateX(46px)}
:root.js .reveal.from-left,:root.js .reveal.from-right{transition-duration:1.9s}
header.top.scrolled{box-shadow:0 6px 24px rgba(15,23,42,.10)}
.lightbox{position:fixed;inset:0;background:rgba(5,8,12,.92);display:flex;align-items:center;justify-content:center;padding:24px;z-index:60;cursor:zoom-out}
.lightbox[hidden]{display:none}
.lightbox img{max-width:100%;max-height:100%;border-radius:14px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.pairrow{display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap;max-width:100%;max-height:100%}
.pairfig{margin:0;display:flex;flex-direction:column;align-items:center;max-width:48%}
.pairfig img{max-width:100%;max-height:80vh;object-fit:contain}
.pairfig figcaption{margin-top:10px;color:#fff;font-weight:700;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase}
@media(max-width:640px){.pairfig{max-width:100%}.pairfig img{max-height:40vh}}
.gallery img,:root.js .ba img{cursor:zoom-in}
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
@media(prefers-reduced-motion:reduce){:root.js .reveal{opacity:1;transform:none;transition:none}:root.js .reveal .services li,:root.js .reveal .gallery li{opacity:1;transform:none;transition:none}:root.js .reveal h2::after{width:48px;transition:none}.gallery li:hover img{transform:none}.btn.primary::after{display:none}.totop{transition:none}:root.js .offer{animation:none;background:#fde68a;box-shadow:none}}
header.top{border-bottom:1px solid var(--line);background:var(--card);background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:saturate(1.3) blur(8px);position:sticky;top:0;z-index:5}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;padding-bottom:10px}
.hactions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.btn.small{min-height:38px;padding:7px 14px;font-size:.9rem;gap:5px;border-width:1.5px}
.btn.small svg{width:16px;height:16px}
.name{font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;font-weight:800;letter-spacing:-.025em;font-size:1.3rem;color:var(--ink);text-decoration:none;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:46px;padding:11px 20px;border-radius:var(--btn-radius);font-weight:700;text-decoration:none;border:2px solid var(--primary);transition:transform .12s ease,box-shadow .12s ease,background .12s ease}
.btn.primary{background:var(--primary);background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--primary) 82%,#000));color:#fff;box-shadow:0 2px 6px rgba(15,23,42,.18)}
.btn.primary:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(15,23,42,.26)}
.btn.ghost{background:var(--card);color:var(--primary)}
.btn.ghost:hover{background:var(--band)}
.offer{background:#fde68a;color:#78350f;font-weight:800;text-align:center;padding:15px 16px;border-bottom:3px solid var(--accent)}
:root.js .offer{animation:offerFlash 1.5s ease-in-out infinite}
@keyframes offerFlash{0%,100%{background:#fde68a;box-shadow:0 0 0 0 rgba(245,158,11,0)}50%{background:#fcd34d;box-shadow:0 0 24px 2px rgba(245,158,11,.6)}}
.actions{display:flex;flex-wrap:wrap;gap:12px;padding:24px 0}
section{padding:var(--section-pad) 0}
section.band{background:var(--band);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
h2{font-family:var(--head-font,inherit);font-weight:var(--head-weight,700);letter-spacing:var(--head-spacing,-.005em);font-size:1.6rem;margin:0 0 20px;position:relative;padding-bottom:14px}
h2::after{content:"";position:absolute;left:0;bottom:0;width:48px;height:3px;background:var(--accent);border-radius:2px}
.services{list-style:none;margin:0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.services li{display:flex;justify-content:space-between;align-items:center;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;box-shadow:0 1px 3px rgba(15,23,42,.05);transition:transform .12s ease,box-shadow .12s ease}
.services li:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(15,23,42,.09)}
.svc{font-weight:600}.price{color:var(--primary);font-weight:700;white-space:nowrap}
.gallery{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.gallery img{width:100%;height:160px;object-fit:cover;border-radius:var(--radius);display:block}
.menu-pdf-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:160px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--primary);font-weight:700;text-decoration:none;text-align:center;padding:10px}
.menu-pdf-badge{font-size:.7rem;letter-spacing:.12em;background:var(--primary);color:#fff;border-radius:6px;padding:3px 9px}
.creds{list-style:none;margin:0;padding:0;display:grid;gap:10px;max-width:640px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.creds li{display:flex;gap:12px;align-items:center;color:var(--ink);font-weight:600}
.creds .ck{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:50%;background:var(--band);color:var(--primary);font-weight:800;font-size:.8rem}
.ins-note{margin:16px 0 0;color:var(--muted)}
.team{list-style:none;margin:0;padding:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.team li{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px}
.team-ava{flex:none;width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--primary);color:#fff;font-weight:800;font-size:1.1rem}
.team-info{display:flex;flex-direction:column;min-width:0}
.team-name{font-weight:700;color:var(--ink);overflow-wrap:anywhere}
.team-role{color:var(--muted);font-size:.92rem}
.faq{max-width:760px;display:grid;gap:10px}
.faq details{border:1px solid var(--line);border-radius:var(--radius);background:var(--card);overflow:hidden}
.faq summary{cursor:pointer;padding:14px 16px;font-weight:700;color:var(--ink);list-style:none;display:flex;justify-content:space-between;align-items:center;gap:12px}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";color:var(--primary);font-weight:800;font-size:1.3rem;line-height:1}
.faq details[open] summary::after{content:"−"}
.faq p{margin:0;padding:0 16px 16px;color:var(--muted);line-height:1.6}
.listings{list-style:none;margin:0;padding:0;display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.listing{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column}
.listing-img{position:relative}
.listing-img img{width:100%;height:190px;object-fit:cover;display:block}
.listing-status{position:absolute;top:10px;left:10px;background:var(--primary);color:#fff;font-size:.75rem;font-weight:700;letter-spacing:.04em;padding:4px 10px;border-radius:999px}
.listing-body{padding:12px 14px}
.listing-price{margin:0;font-weight:800;font-size:1.15rem;color:var(--ink)}
.listing-details{margin:4px 0 0;color:var(--muted)}
.ba{list-style:none;margin:0;padding:0;display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}
.ba-cmp{position:relative;border-radius:var(--radius);overflow:hidden;background:var(--band);--pos:50%;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.ba-cmp img{display:block;width:100%;aspect-ratio:4/3;height:auto;object-fit:cover}
.ba-reveal{position:absolute;inset:0;clip-path:inset(0 calc(100% - var(--pos)) 0 0);-webkit-clip-path:inset(0 calc(100% - var(--pos)) 0 0)}
.ba-tag{position:absolute;top:10px;z-index:2;background:rgba(15,23,42,.82);color:#fff;font-size:.74rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:4px 10px;border-radius:999px}
.ba-tag-b{left:10px}.ba-tag-a{right:10px;background:var(--primary)}
.ba-divider{position:absolute;top:0;bottom:0;left:var(--pos);width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);z-index:3}
.ba-handle{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;background:#fff;color:#111;box-shadow:0 2px 10px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700}
:root.js .ba-divider{cursor:ew-resize}
:root.js .ba-divider:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.stars{color:#f59e0b;letter-spacing:1px;white-space:nowrap}
.rev-summary{display:flex;align-items:center;gap:8px;font-size:1.05rem;margin:0 0 18px}
.rev-summary span{color:var(--muted);font-size:.95rem}
.rev-empty{color:var(--muted);margin:0 0 18px}
.revlist{list-style:none;margin:0 0 26px;padding:0;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr))}
.revlist li{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px}
.rev-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.rev-name{font-weight:700;color:var(--ink)}
.rev-text{margin:0;color:var(--muted);line-height:1.5;overflow-wrap:anywhere}
.rev-form{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);max-width:520px;overflow:hidden}
.rev-form summary{cursor:pointer;font-weight:700;font-size:1.1rem;padding:15px 20px;list-style:none;user-select:none}
.rev-form summary::-webkit-details-marker{display:none}
.rev-form summary::after{content:"＋";float:right;color:var(--primary);font-weight:800}
.rev-form[open] summary::after{content:"－"}
.rev-form[open] summary{border-bottom:1px solid var(--line)}
.rev-form>form{padding:18px 20px}
.rev-field{margin-bottom:14px}
.rev-field label,.rev-label{display:block;font-weight:600;font-size:.9rem;margin-bottom:5px;color:var(--ink)}
.rev-form input[type=text],.rev-form textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:var(--bg);color:var(--ink);box-sizing:border-box}
.rev-form textarea{resize:vertical}
.rev-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.rating{display:inline-flex;flex-direction:row-reverse;gap:2px;font-size:1.7rem;line-height:1}
.rating input{position:absolute;width:1px;height:1px;opacity:0}
.rating label{color:#d1d5db;cursor:pointer}
.rating input:checked~label,.rating label:hover,.rating label:hover~label{color:#f59e0b}
.rating input:focus-visible+label{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
.rev-note{color:var(--muted);font-size:.85rem;margin:12px 0 0}
.visit-actions{display:flex;flex-wrap:wrap;gap:10px}
.loc-popup{position:fixed;inset:0;background:rgba(5,8,12,.6);display:none;align-items:center;justify-content:center;padding:20px;z-index:70}
.loc-popup:target{display:flex}
.loc-backdrop{position:absolute;inset:0}
.loc-panel{position:relative;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);max-width:520px;width:100%;max-height:85vh;overflow:auto;padding:26px 24px 24px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.loc-panel h2{margin:0 0 16px}
.loc-close{position:absolute;top:10px;right:16px;font-size:1.4rem;text-decoration:none;color:var(--muted);line-height:1}
.loc-list{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.loc-list li{border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px}
.loc-list h3{margin:0 0 6px;font-size:1.05rem}
.loc-list address{font-style:normal;color:var(--muted);margin:0 0 12px;display:block;overflow-wrap:anywhere}
.loc-actions{display:flex;flex-wrap:wrap;gap:8px}
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
.legal{list-style:none;display:flex;flex-wrap:wrap;gap:4px 16px;margin:8px 0;padding:0}
.legal span{color:var(--muted)}
.policy{max-width:760px;margin:24px auto 8px}
.policy .updated{color:var(--muted);font-size:.9rem;margin:0 0 18px}
.policy h2{margin:28px 0 8px;font-size:1.2rem;color:var(--ink)}
.policy p,.policy li{color:var(--muted)}
.policy ul{padding-left:20px;margin:8px 0}
.policy li{margin:4px 0}
.policy strong{color:var(--ink)}
.callbar{position:fixed;left:0;right:0;bottom:0;display:none;gap:8px;padding:10px 16px;background:var(--card);border-top:1px solid var(--line)}
.callbar .btn{flex:1}
@media (max-width:640px){.callbar{display:flex}body{padding-bottom:72px}header.top .btn{display:none}}`;

const TEMPLATE_CSS: Record<TemplateKey, string> = {
  spotlight: `.hero.spotlight{position:relative;background:var(--primary);color:#fff;overflow:hidden}
.hero.spotlight::before{content:"";position:absolute;inset:0;z-index:0;background-image:var(--photo);background-size:cover;background-position:center;filter:blur(30px) brightness(.72);transform:scale(1.15)}
.hero.spotlight img{position:relative;z-index:1;display:block;width:100%;height:clamp(220px,42vw,380px);object-fit:contain}
.hero.spotlight .shade{position:absolute;inset:0;z-index:2;background:linear-gradient(180deg,rgba(0,0,0,.12) 0%,rgba(0,0,0,.34) 45%,rgba(0,0,0,.80) 100%)}
.hero.spotlight .copy{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:40px 0}
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
.hero.split .hero-img{position:relative;clip-path:polygon(7% 0,100% 0,100% 100%,0% 100%)}
.hero.split .hero-img::before{content:"";position:absolute;inset:0;z-index:0;background-image:var(--photo);background-size:cover;background-position:center;filter:blur(26px) brightness(.82);transform:scale(1.15)}
.hero.split .hero-img img{position:relative;z-index:1;display:block;width:100%;height:clamp(220px,42vw,380px);object-fit:contain}
.hero.split.noimg{display:block}
@media(max-width:720px){.hero.split{grid-template-columns:1fr}.hero.split .hero-img{clip-path:none}.hero.split .hero-img img{min-height:240px}}`,
  editorial: `:root{--head-font:Georgia,Cambria,"Times New Roman",serif}
.hero.editorial{background:var(--band);color:var(--ink);text-align:center;padding:72px 0 56px;border-bottom:1px solid var(--line)}
.hero.editorial .eyebrow{color:var(--primary)}
.hero.editorial h1{font-family:var(--head-font);margin:0 0 14px;font-size:clamp(2.2rem,6.4vw,3.4rem);line-height:1.08;letter-spacing:-.015em}
.hero.editorial .lede{margin:0 auto;max-width:44ch;color:var(--muted);font-size:1.2rem}
.hero.editorial .eyebrow::before,.hero.editorial .eyebrow::after{content:"";display:inline-block;width:30px;height:1px;background:var(--primary);opacity:.55;vertical-align:middle;margin:0 12px}
.hero-band{position:relative;overflow:hidden;padding:44px 16px;background:var(--band)}
.hero-band::before{content:"";position:absolute;inset:0;z-index:0;background-image:var(--photo);background-size:cover;background-position:center;filter:blur(24px) brightness(.9);transform:scale(1.15)}
.hero-band img{position:relative;z-index:1;display:block;width:100%;max-width:960px;margin:0 auto;height:clamp(220px,42vw,380px);object-fit:contain;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.14)}
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

/**
 * Footer links to the site's legal pages. The current page (if any) is shown as
 * plain text, not a link. Relative hrefs, so they stay on the customer host.
 */
function legalNav(current?: PolicyKind): string {
  const items = POLICY_KINDS.map((k) =>
    k === current ? `<li><span>${esc(POLICY_META[k].navLabel)}</span></li>` : `<li><a href="${POLICY_META[k].path}">${esc(POLICY_META[k].navLabel)}</a></li>`,
  ).join("");
  return `<ul class="legal" aria-label="Legal">${items}</ul>`;
}

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
  // Multiple locations: the primary (address/city + phone) plus any extras. When
  // there's more than one, a "Locations" button opens a CSS-only (:target) popup.
  const extraLocations = site.locations ?? [];
  const allLocations = [...(where ? [{ name: "", address: where, phone: site.phone }] : []), ...extraLocations];
  const multiLocation = extraLocations.length > 0 && allLocations.length > 1;
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
    ? `<section aria-labelledby="services-h" class="band reveal from-left">
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
    ? `<section aria-labelledby="about-h" class="reveal from-right">
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
        <h2>Our Location${multiLocation ? "s" : ""}</h2>
        <p class="visit-sub">${multiLocation ? `We have ${allLocations.length} locations` : "Find us on the map"}</p>
        <address class="visit-addr">${esc(where)}</address>
        <div class="visit-actions"><a class="btn ghost" href="${esc(mapsHref(`${site.businessName} ${where}`))}" target="_blank" rel="noopener"${ping("directions")}>Get directions</a>${multiLocation ? `<a class="btn" href="#locations">See all ${allLocations.length} locations</a>` : ""}</div>
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
      ? `<section aria-label="Location and hours" class="band reveal from-right">
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

  // A restaurant/bakery's uploaded menu(s): thumbnails, like the gallery. A
  // photo enlarges in the lightbox on tap (it's a `.gallery img`, so the same
  // script handles it); a PDF is a small tile that opens the file.
  const menuFiles = menuAllowed(site.category) ? site.menu ?? [] : [];
  const menuHtml = menuFiles.length
    ? `<section aria-labelledby="menu-h" class="band reveal">
  <div class="wrap">
    <p class="kicker">Have a look</p>
    <h2 id="menu-h">Our menu</h2>
    <ul class="gallery menu-grid">
      ${menuFiles
        .map((k, i) => {
          const href = photoUrl(ctx, k);
          const label = menuFiles.length > 1 ? ` ${i + 1}` : "";
          return isMenuPdf(k)
            ? `<li><a class="menu-pdf-tile" href="${esc(href)}" target="_blank" rel="noopener"><span class="menu-pdf-badge">PDF</span><span>View menu${label}</span></a></li>`
            : `<li><img src="${esc(href)}" alt="${esc(`${site.businessName} menu${label}`)}" loading="lazy" decoding="async"></li>`;
        })
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : "";

  // A fitness business's uploaded class schedule: one thumbnail/PDF tile, shown
  // like a menu (photo enlarges in the lightbox, PDF opens).
  const scheduleKey = scheduleAllowed(site.category) ? site.schedule : undefined;
  const scheduleHtml = scheduleKey
    ? `<section aria-labelledby="sch-h" class="reveal">
  <div class="wrap">
    <p class="kicker">Plan your week</p>
    <h2 id="sch-h">Class schedule</h2>
    <ul class="gallery menu-grid">
      ${
        isMenuPdf(scheduleKey)
          ? `<li><a class="menu-pdf-tile" href="${esc(photoUrl(ctx, scheduleKey))}" target="_blank" rel="noopener"><span class="menu-pdf-badge">PDF</span><span>View schedule</span></a></li>`
          : `<li><img src="${esc(photoUrl(ctx, scheduleKey))}" alt="${esc(`${site.businessName} class schedule`)}" loading="lazy" decoding="async"></li>`
      }
    </ul>
  </div>
</section>`
    : "";

  // People-facing businesses: the "Meet the team" section (name + role).
  const teamMembers = teamAllowed(site.category) ? site.team ?? [] : [];
  const teamHtml = teamMembers.length
    ? `<section aria-labelledby="team-h" class="reveal">
  <div class="wrap">
    <p class="kicker">The people</p>
    <h2 id="team-h">Meet the team</h2>
    <ul class="team">
      ${teamMembers
        .map((m) => {
          const initial = (m.name.match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
          return `<li><span class="team-ava" aria-hidden="true">${esc(initial)}</span><span class="team-info"><span class="team-name">${esc(m.name)}</span>${m.role ? `<span class="team-role">${esc(m.role)}</span>` : ""}</span></li>`;
        })
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : "";

  // Dentist/clinic: the insurance plans they accept, one per line.
  const insuranceItems = insuranceAllowed(site.category) ? (site.insurance ?? "").split("\n").map((l) => l.trim()).filter(Boolean) : [];
  const insuranceHtml = insuranceItems.length
    ? `<section aria-labelledby="ins-h" class="band reveal">
  <div class="wrap">
    <p class="kicker">Before you visit</p>
    <h2 id="ins-h">Insurance accepted</h2>
    <ul class="creds">
      ${insuranceItems.map((item) => `<li><span class="ck" aria-hidden="true">✓</span>${esc(item)}</li>`).join("\n      ")}
    </ul>
    <p class="ins-note">Not sure if we take your plan? Give us a call and we'll check.</p>
  </div>
</section>`
    : "";

  // Real estate: featured listings (photo + status + price + details).
  const listings = listingsAllowed(site.category) ? site.listings ?? [] : [];
  const listingsHtml = listings.length
    ? `<section aria-labelledby="listings-h" class="band reveal">
  <div class="wrap">
    <p class="kicker">On the market</p>
    <h2 id="listings-h">Featured listings</h2>
    <ul class="listings">
      ${listings
        .map(
          (l, i) =>
            `<li class="listing"><div class="listing-img"><img src="${esc(photoUrl(ctx, l.photo))}" alt="${esc(`Listing ${i + 1}`)}" loading="lazy" decoding="async"><span class="listing-status">${esc(l.status)}</span></div><div class="listing-body">${l.price ? `<p class="listing-price">${esc(l.price)}</p>` : ""}${l.details ? `<p class="listing-details">${esc(l.details)}</p>` : ""}</div></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : "";

  // FAQ (all categories): a native <details> accordion, no JavaScript.
  const faqItems = site.faq ?? [];
  const faqHtml = faqItems.length
    ? `<section aria-labelledby="faq-h" class="reveal">
  <div class="wrap">
    <p class="kicker">Good to know</p>
    <h2 id="faq-h">Frequently asked questions</h2>
    <div class="faq">
      ${faqItems.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n      ")}
    </div>
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
            `<li><div class="ba-cmp" style="--pos:50%"><img class="ba-base" src="${esc(photoUrl(ctx, p.after))}" alt="${esc(`After: ${site.businessName} job ${i + 1}`)}" loading="lazy" decoding="async"><div class="ba-reveal"><img src="${esc(photoUrl(ctx, p.before))}" alt="${esc(`Before: ${site.businessName} job ${i + 1}`)}" loading="lazy" decoding="async"></div><span class="ba-tag ba-tag-b">Before</span><span class="ba-tag ba-tag-a">After</span><div class="ba-divider" role="slider" tabindex="0" aria-label="Drag to compare before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span class="ba-handle" aria-hidden="true">⇄</span></div></div></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</section>`
    : "";

  // The CSS-only (:target) popup listing every location with its phone + a
  // directions link — no JS needed. Trigger buttons link to #locations.
  const locationsPopup = multiLocation
    ? `<div id="locations" class="loc-popup" role="dialog" aria-modal="true" aria-label="Our locations">
  <a href="#main" class="loc-backdrop" aria-label="Close"></a>
  <div class="loc-panel">
    <a href="#main" class="loc-close" aria-label="Close">✕</a>
    <h2>Our locations</h2>
    <ul class="loc-list">
      ${allLocations
        .map(
          (l, i) =>
            `<li><h3>${esc(l.name || (i === 0 ? site.businessName : `Location ${i + 1}`))}</h3><address>${esc(l.address)}</address><div class="loc-actions"><a class="btn primary small" href="${esc(telHref(l.phone))}">${icon("phone")}${esc(l.phone)}</a><a class="btn ghost small" href="${esc(mapsHref(`${site.businessName} ${l.address}`))}" target="_blank" rel="noopener">${icon("pin")}Directions</a></div></li>`,
        )
        .join("\n      ")}
    </ul>
  </div>
</div>`
    : "";

  // Customer reviews: approved ones with stars + average, and the public
  // "Leave a review" form (posts same-origin to /review, no JS needed; the CSS
  // star rating and a honeypot keep it simple and spam-resistant).
  const approvedReviews = site.reviews ?? [];
  const rstats = reviewStats(approvedReviews);
  const stars = (n: number) => `<span class="stars" aria-label="${n} out of 5">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>`;
  const reviewsHtml = `<section aria-labelledby="revs-h" class="band reveal">
  <div class="wrap">
    <p class="kicker">Reviews</p>
    <h2 id="revs-h">Customer reviews</h2>
    ${
      approvedReviews.length
        ? `<p class="rev-summary">${stars(Math.round(rstats.average))} <strong>${rstats.average.toFixed(1)}</strong> <span>· ${rstats.count} review${rstats.count === 1 ? "" : "s"}</span></p>
    <ul class="revlist">
      ${approvedReviews
        .map(
          (r) =>
            `<li><div class="rev-head">${stars(r.rating)}<span class="rev-name">${esc(r.name)}</span></div><p class="rev-text">${esc(r.text)}</p></li>`,
        )
        .join("\n      ")}
    </ul>`
        : `<p class="rev-empty">No reviews yet — be the first to leave one.</p>`
    }
    <details class="rev-form">
      <summary>Leave a review</summary>
      <form method="post" action="/review">
      <input type="text" name="website" class="rev-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="rev-field"><label for="rev-name">Your name</label><input id="rev-name" name="name" type="text" maxlength="60" required></div>
      <div class="rev-field"><span class="rev-label">Rating</span>
        <div class="rating">
          ${[5, 4, 3, 2, 1]
            .map(
              (n) =>
                `<input type="radio" id="rev-star${n}" name="rating" value="${n}"${n === 5 ? " required" : ""}><label for="rev-star${n}" title="${n} star${n === 1 ? "" : "s"}">★</label>`,
            )
            .join("")}
        </div>
      </div>
      <div class="rev-field"><label for="rev-text">Your review</label><textarea id="rev-text" name="text" maxlength="600" rows="3" required></textarea></div>
      <button class="btn primary" type="submit">Submit review</button>
      <p class="rev-note">Reviews appear on the site once the owner approves them.</p>
      </form>
    </details>
  </div>
</section>`;

  // A tiny SVG favicon: the business's initial on the theme colour, inlined as a
  // data URI (no extra request, and the strict CSP allows data: images).
  const favInitial = (site.businessName.match(/[A-Za-z0-9]/)?.[0] ?? "S").toUpperCase();
  const faviconHref = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${theme.primary}"/><text x="16" y="23" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#ffffff">${favInitial}</text></svg>`,
  )}`;

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
<link rel="icon" href="${faviconHref}">
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
    <div class="hactions">
      <a class="btn primary small" href="${esc(telHref(site.phone))}"${ping("call")}>${icon("phone")}Call</a>
      <a class="btn ghost small" href="${esc(smsHref(site.phone))}">${icon("chat")}Text</a>
      ${multiLocation ? `<a class="btn ghost small" href="#locations">${icon("pin")}Locations</a>` : where ? `<a class="btn ghost small" href="${esc(mapsHref(`${site.businessName} ${where}`))}" target="_blank" rel="noopener"${ping("directions")}>${icon("pin")}Directions</a>` : ""}
    </div>
  </div>
</header>
<main id="main">
${buildHero(template, { eyebrow: cat.label, name: site.businessName, headline: headline(site), hero, phone: site.phone, pingCall: ping("call") })}
${site.offer ? `<p class="offer">${esc(site.offer)}</p>` : ""}
${video}
${services}
${about}
${teamHtml}
${insuranceHtml}
${menuHtml}
${scheduleHtml}
${listingsHtml}
${galleryHtml}
${beforeAfterHtml}
${faqHtml}
${reviewsHtml}
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
    ${legalNav()}
    <p>Website by <a href="${esc(ctx.homeUrl)}">SiteVault</a> from 3PandaLabs.</p>
  </div>
</footer>
${locationsPopup}
<nav class="callbar" aria-label="Quick contact">
  <a class="btn primary" href="${esc(telHref(site.phone))}"${ping("call")}>Call</a>
  <a class="btn ghost" href="${esc(smsHref(site.phone))}">Text</a>
  ${multiLocation ? `<a class="btn ghost" href="#locations">Locations</a>` : where ? `<a class="btn ghost" href="${esc(mapsHref(`${site.businessName} ${where}`))}" target="_blank" rel="noopener"${ping("directions")}>Directions</a>` : ""}
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
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-19T…" -> "November 19, 2026" (UTC, no locale/ICU surprises). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * A customer site's legal/policy page (privacy, accessibility, cookies, terms).
 * Same light, per-business look as the site, script-free, with the owner's text
 * or the generated default. The body is escaped markup (renderPolicyMarkup): an
 * owner can edit it freely without any link ever becoming clickable.
 */
export function renderPolicyPage(site: Site, kind: PolicyKind, ctx: RenderContext): string {
  const cat = CATEGORIES[site.category];
  const theme = themeFor(site.category, cat.brand);
  const meta = POLICY_META[kind];
  const title = `${meta.title} | ${site.businessName}`;
  const markup = renderPolicyMarkup(policyBody(site, kind, ctx.siteUrl));
  const updated = formatDate(site.updatedAt);
  const favInitial = (site.businessName.match(/[A-Za-z0-9]/)?.[0] ?? "S").toUpperCase();
  const faviconHref = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${theme.primary}"/><text x="16" y="23" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#ffffff">${favInitial}</text></svg>`,
  )}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${meta.title} for ${site.businessName}.`)}">
<link rel="canonical" href="${esc(ctx.siteUrl)}${meta.path.slice(1)}">
<meta name="theme-color" content="${theme.primary}">
<link rel="icon" href="${faviconHref}">
<style>${baseCss(theme)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="name" href="${esc(ctx.siteUrl)}">${esc(site.businessName)}</a>
    <div class="hactions">
      <a class="btn primary small" href="${esc(telHref(site.phone))}">Call</a>
    </div>
  </div>
</header>
<main id="main">
  <div class="wrap">
    <article class="policy">
      <h1>${esc(meta.title)}</h1>
      ${updated ? `<p class="updated">Last updated: ${esc(updated)}</p>` : ""}
      ${markup}
      <p><a href="${esc(ctx.siteUrl)}">&larr; Back to ${esc(site.businessName)}</a></p>
    </article>
  </div>
</main>
<footer>
  <div class="wrap">
    <p>&copy; ${new Date().getUTCFullYear()} ${esc(site.businessName)}.</p>
    ${legalNav(kind)}
    <p>Website by <a href="${esc(ctx.homeUrl)}">SiteVault</a> from 3PandaLabs.</p>
  </div>
</footer>
</body>
</html>`;
}

/** The minimal, business-branded page a visitor sees after submitting a review. */
export function reviewResultPage(siteUrl: string, businessName: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(businessName)}</title><meta name="robots" content="noindex"><style>body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f6f7f9;color:#111827;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}.box{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(15,23,42,.08)}h1{font-size:1.2rem;margin:0 0 10px}p{color:#4b5563;line-height:1.5;margin:0 0 22px}a{display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none;font-weight:700}</style></head><body><div class="box"><h1>${esc(businessName)}</h1><p>${esc(message)}</p><a href="${esc(siteUrl)}">Back to the website</a></div></body></html>`;
}

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
