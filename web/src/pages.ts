// SiteVault's own pages: home, the builder (new + edit), done, privacy, terms.
// Server-rendered HTML. The builder has one small inline script (CSP nonce)
// that shrinks photos in the browser before upload, so a 12 MB phone photo
// arrives as ~300 KB; without JavaScript the form still posts normally.

import { CATEGORIES, MAX_PHOTOS, servicesToText, type FieldErrors, type Site } from "./site.js";
import { esc } from "./util.js";

const CONTACT = "3pandas@3pandalabs.com";

export function layout(opts: { title: string; body: string; nonce?: string; script?: string; noindex?: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="A simple website for your local business in about five minutes. Built from your own details and photos.">
${opts.noindex ? '<meta name="robots" content="noindex">' : ""}
<meta name="theme-color" content="#0f172a">
<style>
:root{--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#b45309;--accent-bg:#fef3c7;--bg:#ffffff;--soft:#f8fafc;--err:#b91c1c}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;font-size:17px}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
a{color:var(--accent)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,.btn:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
header.top{border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:12px;padding-bottom:12px;gap:12px}
.logo{font-weight:800;color:var(--ink);text-decoration:none;font-size:1.15rem}
.logo span{color:var(--accent)}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 20px;border-radius:10px;font-weight:700;text-decoration:none;border:2px solid var(--ink);background:var(--ink);color:#fff;font-size:1rem;cursor:pointer}
.btn.ghost{background:#fff;color:var(--ink)}
.btn[disabled]{opacity:.6;cursor:progress}
.hero{padding:56px 0 32px}
.hero h1{font-size:clamp(2rem,6vw,3rem);line-height:1.1;margin:0 0 12px}
.lead{font-size:1.2rem;color:var(--muted);margin:0 0 24px}
.steps{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));padding:16px 0 40px}
.card{border:1px solid var(--line);border-radius:14px;padding:18px;background:#fff}
.card h3{margin:0 0 6px;font-size:1.05rem}
.card p{margin:0;color:var(--muted)}
.pill{display:inline-block;background:var(--accent-bg);color:#78350f;font-weight:700;border-radius:999px;padding:4px 12px;font-size:.85rem;margin-bottom:14px}
section{padding:24px 0}
form .field{margin:0 0 18px}
label{display:block;font-weight:700;margin-bottom:6px}
.hint{display:block;font-weight:400;color:var(--muted);font-size:.9rem}
input[type=text],input[type=tel],input[type=email],select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #94a3b8;border-radius:10px;background:#fff;color:var(--ink)}
textarea{min-height:110px;resize:vertical}
.err{color:var(--err);font-size:.9rem;margin-top:4px}
.err:empty{display:none}
.row{display:grid;gap:0 16px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
fieldset{border:1px solid var(--line);border-radius:14px;padding:16px 16px 4px;margin:0 0 20px}
legend{font-weight:800;padding:0 6px}
.photos{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}
.photos label{font-weight:400;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.85rem}
.photos img{width:96px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}
.check input{margin-top:5px;width:18px;height:18px}
.notice{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.ok{background:#ecfdf5;border-color:#a7f3d0}
.copybox{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.copybox code{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;overflow-wrap:anywhere;flex:1;min-width:0;font-size:.9rem}
footer{border-top:1px solid var(--line);margin-top:40px;padding:24px 0 40px;color:var(--muted);font-size:.9rem}
footer a{color:var(--muted)}
.prose h2{margin-top:28px}
</style>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="/">Site<span>Vault</span></a>
  <a class="btn ghost" href="/new">Build my website</a>
</div></header>
<main id="main" class="wrap">
${opts.body}
</main>
<footer><div class="wrap">
  <p>SiteVault by 3PandaLabs LLC, New Jersey. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="mailto:${CONTACT}">${CONTACT}</a></p>
</div></footer>
${opts.script && opts.nonce ? `<script nonce="${opts.nonce}">${opts.script}</script>` : ""}
</body>
</html>`;
}

export function homePage(): string {
  return layout({
    title: "SiteVault: a website for your business in 5 minutes",
    body: `<section class="hero">
  <span class="pill">Free during early access</span>
  <h1>A website for your business in about five minutes.</h1>
  <p class="lead">No design work and no tech skills. Tell us about your business, add a few photos, and get a clean, phone-friendly site customers can call you from.</p>
  <a class="btn" href="/new">Build my website</a>
</section>
<div class="steps">
  <div class="card"><h3>1. Tell us the basics</h3><p>Name, phone, what you offer, where you work, your hours.</p></div>
  <div class="card"><h3>2. Add photos</h3><p>Your shop, your team, your work. Straight from your phone.</p></div>
  <div class="card"><h3>3. Share your link</h3><p>Put it on Google, your ads, your van, your business cards.</p></div>
</div>
<section>
  <h2>What's on your site</h2>
  <div class="steps">
    <div class="card"><h3>Tap to call and text</h3><p>Big buttons, made for phones, where most customers find you.</p></div>
    <div class="card"><h3>Services and prices</h3><p>Exactly what you offer, in your own words.</p></div>
    <div class="card"><h3>Hours, area, directions</h3><p>Everything a customer checks before they call.</p></div>
    <div class="card"><h3>Fast and private</h3><p>Loads quickly on any phone. No cookies, no tracking.</p></div>
  </div>
  <p>Running video ads with <a href="https://advault.3pandalabs.com">AdVault</a>? Your SiteVault link works as your ad's website.</p>
</section>`,
  });
}

export type FormMode = { kind: "new" } | { kind: "edit"; site: Site; key: string; photoUrl: (k: string) => string };

const FIELD_ORDER = [
  "businessName",
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
  "attest",
] as const;

export function builderPage(mode: FormMode, nonce: string, errors: FieldErrors = {}, values: Record<string, string> = {}): string {
  const site = mode.kind === "edit" ? mode.site : null;
  const v = (k: string, fallback = "") => esc(values[k] ?? fallback);
  const e = (k: string) => `<div class="err" id="err-${k}" role="alert">${esc(errors[k] ?? "")}</div>`;
  const action = mode.kind === "edit" ? `/api/sites/${encodeURIComponent(mode.site.slug)}` : "/api/sites";
  const selectedCat = values.category ?? site?.category ?? "";

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
  <div class="row">
    <div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="phone" maxlength="24" required value="${v("phone", site?.phone)}" autocomplete="tel" placeholder="(201) 555-0100">${e("phone")}</div>
    <div class="field"><label for="city">Town or city</label><input type="text" id="city" name="city" maxlength="60" required value="${v("city", site?.city)}" placeholder="Secaucus, NJ">${e("city")}</div>
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
  <div class="field"><label for="offer">Current special <span class="hint">Optional. Shown in a banner.</span></label><input type="text" id="offer" name="offer" maxlength="160" value="${v("offer", site?.offer ?? "")}" placeholder="Spring cleanup from $149, this month only">${e("offer")}</div>
  <div class="field"><label for="services">Services and prices <span class="hint">Optional. One per line, price after a dash.</span></label><textarea id="services" name="services" placeholder="Lawn mowing - from $35&#10;Spring cleanup - $149&#10;Hedge trimming">${v("services", site ? servicesToText(site.services) : "")}</textarea>${e("services")}</div>
  <div class="field"><label for="hours">Opening hours <span class="hint">Optional</span></label><textarea id="hours" name="hours" placeholder="Mon-Fri 8am-6pm&#10;Sat 9am-2pm&#10;Sun closed">${v("hours", site?.hours ?? "")}</textarea>${e("hours")}</div>
  <div class="field"><label for="about">About your business <span class="hint">Optional. A few sentences in your own words.</span></label><textarea id="about" name="about" maxlength="1200">${v("about", site?.about)}</textarea>${e("about")}</div>
</fieldset>
<fieldset><legend>Photos</legend>
  ${existing}
  <div class="field"><label for="photos">Add photos <span class="hint">Up to ${MAX_PHOTOS} in total. JPG, PNG or WebP. Use photos you took or have the right to use.</span></label><input type="file" id="photos" name="photos" accept="image/jpeg,image/png,image/webp" multiple>${e("photos")}</div>
</fieldset>
<div class="field"><label class="check"><input type="checkbox" name="attest" value="yes" required${mode.kind === "edit" ? " checked" : ""}> <span>I own or run this business (or have its permission), the details are accurate, and I agree to the <a href="/terms" target="_blank">Terms</a>.</span></label>${e("attest")}</div>
<div class="err" id="err-form" role="alert">${esc(errors.form ?? "")}</div>
<button class="btn" type="submit" id="submit">${mode.kind === "edit" ? "Save changes" : "Create my website"}</button>
</form>
${
  mode.kind === "edit"
    ? `<form method="post" action="/api/sites/${encodeURIComponent(mode.site.slug)}/delete" style="margin-top:28px" class="notice">
  <input type="hidden" name="key" value="${esc(mode.key)}">
  <p><strong>Remove your website.</strong> Takes it offline and deletes its photos. This can't be undone.</p>
  <button class="btn ghost" type="submit" id="delete">Remove my website</button>
</form>`
    : ""
}
</section>`;

  return layout({
    title: mode.kind === "edit" ? "Edit your website | SiteVault" : "Build your website | SiteVault",
    body,
    nonce,
    noindex: mode.kind === "edit",
    script: BUILDER_SCRIPT,
  });
}

// Shrinks photos client-side, posts with fetch, shows field errors inline.
// Falls back to the normal multipart post when anything here is unsupported.
const BUILDER_SCRIPT = `
(function(){
  var form=document.getElementById('builder'); if(!form||!window.fetch||!window.FormData) return;
  var del=document.getElementById('delete');
  if(del) del.form.addEventListener('submit',function(ev){ if(!confirm('Remove your website? This cannot be undone.')) ev.preventDefault(); });
  var FIELDS=${JSON.stringify(FIELD_ORDER)};
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

export function donePage(opts: { siteUrl: string; editUrl: string; nonce: string }): string {
  return layout({
    title: "Your website is live | SiteVault",
    noindex: true,
    nonce: opts.nonce,
    script: `document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function(){b.textContent='Copied';});});});`,
    body: `<section>
<h1>Your website is live 🎉</h1>
<div class="notice ok">
  <p><strong>Your website</strong></p>
  <div class="copybox"><code>${esc(opts.siteUrl)}</code><button class="btn ghost" type="button" data-copy="${esc(opts.siteUrl)}">Copy</button><a class="btn" href="${esc(opts.siteUrl)}" target="_blank">Open</a></div>
</div>
<div class="notice" style="margin-top:16px">
  <p><strong>Your private edit link. Save it now.</strong> It's the only way to change your site. Anyone with it can edit, so don't share it. Bookmark this page or email the link to yourself.</p>
  <div class="copybox"><code>${esc(opts.editUrl)}</code><button class="btn ghost" type="button" data-copy="${esc(opts.editUrl)}">Copy</button></div>
</div>
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
<p>Last updated 15 November 2026. SiteVault is run by 3PandaLabs LLC, a New Jersey company. Contact: <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<h2>What we store</h2>
<ul>
  <li><strong>The details you enter</strong> (business name, phone, email, address, services, hours and text) and <strong>the photos you upload</strong>. These are published on your website, which is public.</li>
  <li><strong>A scrambled copy of your private edit key</strong>, so we can check it without storing the key itself.</li>
  <li><strong>A short-lived counter per network address</strong> to limit how many sites can be created in a day. It expires after about a day.</li>
</ul>
<h2>What we don't do</h2>
<ul>
  <li>No cookies, analytics or advertising trackers on SiteVault or on the websites it makes.</li>
  <li>We don't sell or share your details. They're shown on your website because you asked us to publish them.</li>
</ul>
<h2>Where it's kept</h2>
<p>Sites and photos are stored and served by Cloudflare, our hosting provider, in its global network. Visitors' browsers connect to Cloudflare to load your site, as with any website.</p>
<h2>Your choices</h2>
<p>Change or remove anything at any time with your edit link. Removing your website deletes its photos and takes it offline. If you've lost your edit link, email us from the address on your site and we'll help.</p>
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
<p>Last updated 15 November 2026. These terms are between you and 3PandaLabs LLC (New Jersey), which runs SiteVault.</p>
<h2>Your content</h2>
<p>You must own or run the business, or have its permission. Everything you publish must be true and lawful, and you must have the right to use every photo. You keep ownership of your content and give us permission to host and display it on your website.</p>
<h2>Not allowed</h2>
<p>Impersonating another business, misleading claims or prices, collecting passwords or payments, illegal goods or services, adult content, hate, or anything that breaks the law. Links to other websites can't be added to page text. We may remove any site that breaks these rules, without notice.</p>
<h2>Real estate</h2>
<p>Housing-related sites must follow US fair-housing law, including not stating preferences based on protected characteristics.</p>
<h2>Price</h2>
<p>SiteVault is free during early access. If we introduce paid plans we'll tell you before anything changes for your site, and you can remove your site at any time.</p>
<h2>No guarantee</h2>
<p>SiteVault is provided as is. We work to keep sites online but don't guarantee uninterrupted service. To the extent the law allows, our liability is limited to the amount you've paid us in the last 12 months.</p>
<h2>Law</h2>
<p>These terms are governed by the laws of New Jersey, USA.</p>
</section>`,
  });
}
