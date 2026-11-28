// HTML for quotes, call-backs, bookings and review requests (2026-11-27).
// Customer-site parts are plain HTML forms (work with JS off, post to the
// site's own host, no third-party anything); owner parts use SiteVault's own
// page chrome. Every value goes through esc().

import {
  DAYS_AHEAD_CHOICES,
  LEAD_HOUR_CHOICES,
  MAX_BOOKING_SERVICES,
  MAX_LEAD_PHOTOS,
  US_TIMEZONES,
  WEEKDAYS,
  WINDOWS_PER_DAY,
  bookingOn,
  bookingWhen,
  dateLabel,
  defaultBooking,
  leadFeaturesOn,
  reviewUrlFor,
  sourceParams,
  type BookingSettings,
  type LeadKind,
  type LeadSource,
  type Slot,
} from "./leads.js";
import type { Lead } from "./leads-api.js";
import type { Site } from "./site.js";
import { esc, telHref } from "./util.js";

// ---------------------------------------------------------------------------
// Customer site

/** Extra CSS for the lead forms and booking pages (customer sites). */
export const LEAD_CSS = `.lead-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));align-items:start}
.lead-form input[type=text],.lead-form input[type=tel],.lead-form input[type=email],.lead-form select,.lead-form textarea{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font:inherit;background:var(--bg);color:var(--ink);box-sizing:border-box}
.lead-form input[type=file]{font:inherit;max-width:100%}
.lead-form .opt{font-weight:400;color:var(--muted)}
.lead-err{color:#b91c1c;font-size:.9rem;margin:4px 0 0}
.lead-note{color:var(--muted);font-size:.88rem;margin:10px 0 0}
.lead-alert{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d;border-radius:10px;padding:12px 14px;margin:0 0 16px}
.lead-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d;border-radius:10px;padding:14px 16px;margin:0 0 16px}
.choice-list{list-style:none;padding:0;margin:0 0 16px;display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))}
.choice-list a,.choice-list label{display:flex;flex-direction:column;justify-content:center;min-height:48px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);text-decoration:none;cursor:pointer}
.choice-list a:hover,.choice-list label:hover{border-color:var(--primary)}
.choice-list input{position:absolute;opacity:0;width:1px;height:1px}
.choice-list input:checked+span{font-weight:800;color:var(--primary)}
.choice-list label:has(input:checked){border-color:var(--primary);box-shadow:0 0 0 2px var(--primary)}
.choice-list label:has(input:focus-visible){outline:3px solid #f59e0b;outline-offset:2px}
.choice-list small{color:var(--muted)}
.sub-main{padding:32px 0 64px}
.sub-main h1{font-family:var(--head-font);margin:0 0 8px;font-size:clamp(1.5rem,4vw,2rem)}
.steps{color:var(--muted);font-size:.9rem;margin:0 0 18px}
.g-rating{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 14px}`;

const hidden = (name: string, value: string) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`;
const srcHidden = (s: LeadSource) => sourceParams(s).map(([k, v]) => hidden(k, v)).join("");
const honeypot = `<input type="text" name="website" class="rev-hp" tabindex="-1" autocomplete="off" aria-hidden="true">`;
const fieldErr = (errors: Record<string, string>, k: string) => (errors[k] ? `<p class="lead-err" id="${k}-err">${esc(errors[k])}</p>` : "");

/** The visitor's contact fields, shared by every lead form. `p` keeps ids unique on the page. */
function contactFields(kind: LeadKind, p: string, values: Record<string, string>, errors: Record<string, string>): string {
  const v = (k: string) => esc(values[k] ?? "");
  const desc = (k: string) => (errors[k] ? ` aria-invalid="true" aria-describedby="${k}-err"` : "");
  return `<div class="rev-field"><label for="${p}-name">Your name</label><input id="${p}-name" name="name" type="text" maxlength="80" required autocomplete="name" value="${v("name")}"${desc("name")}>${fieldErr(errors, "name")}</div>
      <div class="rev-field"><label for="${p}-phone">Phone</label><input id="${p}-phone" name="phone" type="tel" maxlength="30" required autocomplete="tel" value="${v("phone")}"${desc("phone")}>${fieldErr(errors, "phone")}</div>
      <div class="rev-field"><label for="${p}-email">Email${kind === "booking" ? "" : ` <span class="opt">(optional)</span>`}</label><input id="${p}-email" name="email" type="email" maxlength="254"${kind === "booking" ? " required" : ""} autocomplete="email" value="${v("email")}"${desc("email")}>${fieldErr(errors, "email")}</div>`;
}

export type LeadFormOpts = { idem: string; source: LeadSource; values?: Record<string, string>; errors?: Record<string, string> };

/** The quote form (name, phone, email, message, up to 3 photos). */
export function quoteForm(o: LeadFormOpts, p = "q"): string {
  const values = o.values ?? {};
  const errors = o.errors ?? {};
  return `<form method="post" action="/lead" enctype="multipart/form-data" class="lead-form">
      ${hidden("kind", "quote")}${hidden("idem", o.idem)}${srcHidden(o.source)}${honeypot}
      ${contactFields("quote", p, values, errors)}
      <div class="rev-field"><label for="${p}-message">What do you need?</label><textarea id="${p}-message" name="message" maxlength="2000" rows="4">${esc(values.message ?? "")}</textarea></div>
      <div class="rev-field"><label for="${p}-photos">Photos <span class="opt">(optional, up to ${MAX_LEAD_PHOTOS})</span></label><input id="${p}-photos" name="photos" type="file" accept="image/*" multiple${errors.photos ? ` aria-invalid="true" aria-describedby="photos-err"` : ""}>${fieldErr(errors, "photos")}</div>
      <button class="btn primary" type="submit">Send my request</button>
      </form>`;
}

/** The call-back form (name, phone, best time). */
export function callbackForm(o: LeadFormOpts, p = "cb"): string {
  const values = o.values ?? {};
  const errors = o.errors ?? {};
  return `<form method="post" action="/lead" class="lead-form">
      ${hidden("kind", "callback")}${hidden("idem", o.idem)}${srcHidden(o.source)}${honeypot}
      <div class="rev-field"><label for="${p}-name">Your name</label><input id="${p}-name" name="name" type="text" maxlength="80" required autocomplete="name" value="${esc(values.name ?? "")}">${fieldErr(errors, "name")}</div>
      <div class="rev-field"><label for="${p}-phone">Phone</label><input id="${p}-phone" name="phone" type="tel" maxlength="30" required autocomplete="tel" value="${esc(values.phone ?? "")}">${fieldErr(errors, "phone")}</div>
      <div class="rev-field"><label for="${p}-best">Best time to call <span class="opt">(optional)</span></label><input id="${p}-best" name="bestTime" type="text" maxlength="80" placeholder="Weekdays after 5 pm" value="${esc(values.bestTime ?? "")}"></div>
      <button class="btn primary" type="submit">Call me back</button>
      </form>`;
}

/**
 * The sections on the published site: "Book online" (when bookings are on)
 * and "Request a quote" / "Call me back". Empty when the plan gate is off.
 */
export function siteLeadSections(site: Site, o: { idem: string; source: LeadSource }): { booking: string; quote: string } {
  if (!leadFeaturesOn(site)) return { booking: "", quote: "" };
  const b = site.booking;
  const booking =
    bookingOn(site) && b
      ? `<section aria-labelledby="book-h" class="reveal" id="book">
  <div class="wrap">
    <p class="kicker">Book online</p>
    <h2 id="book-h">Book an appointment</h2>
    <form method="get" action="/book" class="lead-form">
      ${srcHidden(o.source)}
      <fieldset style="border:0;padding:0;margin:0"><legend class="rev-label" style="margin-bottom:10px">Choose a service</legend>
      <ul class="choice-list">
        ${b.services.map((s, i) => `<li><label><input type="radio" name="service" value="${i}"${i === 0 ? " checked" : ""}><span>${esc(s.name)}</span><small>${s.durationMin} min${s.price ? ` · ${esc(s.price)}` : ""}</small></label></li>`).join("\n        ")}
      </ul></fieldset>
      <button class="btn primary" type="submit">Choose a time</button>
      <p class="lead-note">You send a request; ${esc(site.businessName)} confirms it by email.</p>
    </form>
  </div>
</section>`
      : "";
  const quote = `<section aria-labelledby="quote-h" class="band reveal" id="quote">
  <div class="wrap">
    <p class="kicker">Ask us</p>
    <h2 id="quote-h">Request a quote or a call back</h2>
    <div class="lead-grid">
      <details class="rev-form" id="get-quote">
        <summary>Request a quote</summary>
        ${quoteForm(o)}
      </details>
      <details class="rev-form" id="call-back">
        <summary>Call me back</summary>
        ${callbackForm(o)}
      </details>
    </div>
    <p class="lead-note">Your details go only to ${esc(site.businessName)}, to answer you.</p>
  </div>
</section>`;
  return { booking, quote };
}

/** The Google rating line + "Review us on Google" for the reviews section. */
export function googleReviewLine(site: Site): string {
  if (!leadFeaturesOn(site)) return "";
  const r = site.googleRating;
  const url = reviewUrlFor(site);
  if (!r && !url) return "";
  return `<div class="g-rating">${r ? `<p style="margin:0"><span class="stars" aria-hidden="true">★</span> <strong>${r.rating.toFixed(1)}</strong> on Google${r.count !== null ? ` · ${r.count} review${r.count === 1 ? "" : "s"}` : ""}</p>` : ""}${url ? `<a class="btn ghost small" href="/review">Review us on Google</a>` : ""}</div>`;
}

// ---------------------------------------------------------------------------
// Customer-site sub pages (bodies; render.ts renderSubPage wraps them)

export function stepsLine(step: 1 | 2 | 3): string {
  return `<p class="steps">Step ${step} of 3: ${["choose a service", "choose a day", "choose a time and add your details"][step - 1]}</p>`;
}

export function bookServiceBody(site: Site, b: BookingSettings, source: LeadSource, notice?: string): string {
  return `<h1>Book with ${esc(site.businessName)}</h1>${stepsLine(1)}
${notice ? `<p class="lead-alert" role="alert">${esc(notice)}</p>` : ""}
<form method="get" action="/book" class="lead-form">${srcHidden(source)}
<fieldset style="border:0;padding:0;margin:0"><legend class="rev-label" style="margin-bottom:10px">Choose a service</legend>
<ul class="choice-list">${b.services.map((s, i) => `<li><label><input type="radio" name="service" value="${i}"${i === 0 ? " checked" : ""}><span>${esc(s.name)}</span><small>${s.durationMin} min${s.price ? ` · ${esc(s.price)}` : ""}</small></label></li>`).join("")}</ul></fieldset>
<button class="btn primary" type="submit">Choose a time</button></form>`;
}

export function bookDateBody(site: Site, b: BookingSettings, svc: number, dates: { date: string; label: string; slots: number }[], source: LeadSource, notice?: string): string {
  const s = b.services[svc]!;
  const q = (date: string) => `/book?${new URLSearchParams([["service", String(svc)], ["date", date], ...sourceParams(source)])}`;
  return `<h1>${esc(s.name)}</h1>${stepsLine(2)}
<p>${s.durationMin} minutes${s.price ? ` · ${esc(s.price)}` : ""}. <a href="/book?${new URLSearchParams([...sourceParams(source)])}">Change service</a></p>
${notice ? `<p class="lead-alert" role="alert">${esc(notice)}</p>` : ""}
${
  dates.length
    ? `<h2 style="font-size:1.1rem">Choose a day</h2><ul class="choice-list">${dates.map((d) => `<li><a href="${esc(q(d.date))}"><span>${esc(d.label)}</span><small>${d.slots} time${d.slots === 1 ? "" : "s"} free</small></a></li>`).join("")}</ul>`
    : `<p class="lead-alert">No free times in the next ${b.daysAhead} days. Please call <a href="${esc(telHref(site.phone))}">${esc(site.phone)}</a>.</p>`
}`;
}

export function bookTimeBody(
  site: Site,
  b: BookingSettings,
  svc: number,
  date: string,
  slots: Slot[],
  o: LeadFormOpts & { chosen?: string; notice?: string },
): string {
  const s = b.services[svc]!;
  const tz = US_TIMEZONES.find((z) => z.id === b.timezone)?.label ?? "";
  const back = `/book?${new URLSearchParams([["service", String(svc)], ...sourceParams(o.source)])}`;
  const errors = o.errors ?? {};
  return `<h1>${esc(s.name)}, ${esc(dateLabel(date, true))}</h1>${stepsLine(3)}
<p>${s.durationMin} minutes${s.price ? ` · ${esc(s.price)}` : ""}. Times are ${esc(tz)} time. <a href="${esc(back)}">Change day</a></p>
${o.notice ? `<p class="lead-alert" role="alert">${esc(o.notice)}</p>` : ""}
${
  slots.length
    ? `<form method="post" action="/book" class="lead-form">
${hidden("service", String(svc))}${hidden("date", date)}${hidden("idem", o.idem)}${srcHidden(o.source)}${honeypot}
<fieldset style="border:0;padding:0;margin:0"><legend class="rev-label" style="margin-bottom:10px">Choose a time</legend>
<ul class="choice-list">${slots.map((t, i) => `<li><label><input type="radio" name="start" value="${esc(t.start)}"${(o.chosen ? o.chosen === t.start : i === 0) ? " checked" : ""} required><span>${esc(t.label)}</span></label></li>`).join("")}</ul>${fieldErr(errors, "start")}</fieldset>
<div style="max-width:520px">
${contactFields("booking", "bk", o.values ?? {}, errors)}
<div class="rev-field"><label for="bk-message">Anything we should know? <span class="opt">(optional)</span></label><textarea id="bk-message" name="message" maxlength="2000" rows="3">${esc(o.values?.message ?? "")}</textarea></div>
<button class="btn primary" type="submit">Send booking request</button>
<p class="lead-note">This is a request. ${esc(site.businessName)} will confirm it by email.</p>
</div></form>`
    : `<p class="lead-alert">No free times left on this day. <a href="${esc(back)}">Pick another day</a>.</p>`
}`;
}

/** The thank-you after any lead. */
export function leadThanksBody(site: Site, kind: LeadKind): string {
  const msg =
    kind === "booking"
      ? `Request sent — ${site.businessName} will confirm by email.`
      : kind === "callback"
        ? `Thanks! ${site.businessName} will call you back soon.`
        : `Thanks! ${site.businessName} has your request and will get back to you soon.`;
  return `<h1>${kind === "booking" ? "Request sent" : "Thank you"}</h1>
<p class="lead-ok" role="status">${esc(msg)}</p>
<p>Need them sooner? Call <a href="${esc(telHref(site.phone))}">${esc(site.phone)}</a>.</p>
<p><a href="/">&larr; Back to ${esc(site.businessName)}</a></p>`;
}

/** A quote/call-back form that needs fixing, or couldn't be sent (values kept). */
export function leadRetryBody(site: Site, kind: "quote" | "callback", o: LeadFormOpts & { notice: string }): string {
  return `<h1>${kind === "quote" ? "Request a quote" : "Call me back"}</h1>
<p class="lead-alert" role="alert">${esc(o.notice)}</p>
<div class="rev-form" style="max-width:520px">${kind === "quote" ? quoteForm(o) : callbackForm(o)}</div>
<p><a href="/">&larr; Back to ${esc(site.businessName)}</a></p>`;
}

export const couldntSend = (site: Site) => `Sorry, we couldn't send your request. Please call ${site.phone}.`;

/** <slug>.3pandasite.com/review: the friendly ask before Google. */
export function reviewAskBody(site: Site, url: string): string {
  return `<h1>Thanks for choosing ${esc(site.businessName)}</h1>
<p>Enjoyed your visit? A short Google review helps other people find us. It takes a minute.</p>
<p><a class="btn primary" href="${esc(url)}" rel="noopener">Leave a review on Google</a></p>
<p class="lead-note">This opens Google's review page.</p>
<p><a href="/">&larr; Back to ${esc(site.businessName)}</a></p>`;
}

// ---------------------------------------------------------------------------
// Owner: the editor's "Bookings & reviews" section (SiteVault chrome)

export function bookingSettingsSection(
  site: Site,
  opts: { key: string; embed: boolean; errors?: Record<string, string>; saved?: boolean; siteUrl: string; values?: Record<string, string> },
): string {
  if (!leadFeaturesOn(site)) return "";
  const slug = encodeURIComponent(site.slug);
  const b = site.booking ?? defaultBooking(site);
  const errors = opts.errors ?? {};
  const values = opts.values;
  const err = (k: string) => `<div class="err" role="alert">${esc(errors[k] ?? "")}</div>`;
  const val = (k: string, fallback: string) => esc(values ? values[k] ?? "" : fallback);
  const checked = (k: string, on: boolean) => ((values ? values[k] === "yes" : on) ? " checked" : "");
  const svcRows = Array.from({ length: MAX_BOOKING_SERVICES }, (_, i) => {
    const s = b.services[i];
    return `<div class="row"><div class="field"><label for="svcName${i}">Service ${i + 1}</label><input type="text" id="svcName${i}" name="svcName${i}" maxlength="80" value="${val(`svcName${i}`, s?.name ?? "")}"${i === 0 ? ' placeholder="Haircut"' : ""}></div>
<div class="field"><label for="svcMin${i}">Minutes</label><input type="number" id="svcMin${i}" name="svcMin${i}" min="5" max="480" step="5" inputmode="numeric" value="${val(`svcMin${i}`, s ? String(s.durationMin) : "")}"${i === 0 ? ' placeholder="30"' : ""}></div>
<div class="field"><label for="svcPrice${i}">Price <span class="hint">Optional</span></label><input type="text" id="svcPrice${i}" name="svcPrice${i}" maxlength="40" value="${val(`svcPrice${i}`, s?.price ?? "")}"${i === 0 ? ' placeholder="$25"' : ""}></div></div>`;
  }).join("\n");
  const dayRows = WEEKDAYS.map(({ day, label }) => {
    const w = b.weekly[day] ?? [];
    const win = (i: number) =>
      `<input type="time" name="day${day}s${i}" aria-label="${label} ${i ? "second " : ""}start" value="${val(`day${day}s${i}`, w[i]?.start ?? "")}"> to <input type="time" name="day${day}e${i}" aria-label="${label} ${i ? "second " : ""}end" value="${val(`day${day}e${i}`, w[i]?.end ?? "")}">`;
    return `<div class="field"><label class="check"><input type="checkbox" name="day${day}" value="yes"${checked(`day${day}`, w.length > 0)}> <span>${label}</span></label>
<div class="hint" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${win(0)}${WINDOWS_PER_DAY > 1 ? ` <span>and (optional)</span> ${win(1)}` : ""}</div></div>`;
  }).join("\n");
  const sel = (name: string, choices: number[], current: number, unit: (n: number) => string) =>
    `<select id="${name}" name="${name}">${choices.map((n) => `<option value="${n}"${(values ? values[name] === String(n) : current === n) ? " selected" : ""}>${esc(unit(n))}</option>`).join("")}</select>`;
  const reviewUrl = reviewUrlFor(site);
  const reviewPage = `${opts.siteUrl.replace(/\/$/, "")}/review`;
  const cardHref = `/edit/${slug}/review-card${opts.embed ? "" : `?k=${encodeURIComponent(opts.key)}`}`;
  return `<section class="narrow" id="bookings" style="margin-top:32px">
<h2>Bookings, quotes &amp; reviews</h2>
${opts.saved ? `<p class="notice ok" role="status"><strong>Saved.</strong></p>` : ""}
${errors.form ? `<p class="err" role="alert">${esc(errors.form)}</p>` : ""}
<p class="hint">Your website always has <strong>Request a quote</strong> and <strong>Call me back</strong>. We email you each request${opts.embed ? "" : `; you can also see them under <a href="/account#leads">My website</a>`}.</p>
<form method="post" action="/api/sites/${slug}/bookings">
${hidden("key", opts.key)}${opts.embed ? hidden("embed", "1") : ""}
<fieldset><legend>Online booking</legend>
  <label class="check"><input type="checkbox" name="bookingOn" value="yes"${checked("bookingOn", b.on)}> <span>Let customers ask to book a time on my website. You confirm or decline each request; they get an email either way.</span></label>
  <p class="hint">What people can book (up to ${MAX_BOOKING_SERVICES}):</p>
  ${svcRows}${err("services")}
  <p class="hint" style="margin-top:14px">When you take bookings:</p>
  ${dayRows}${err("weekly")}
  <div class="row">
    <div class="field"><label for="timezone">Time zone</label><select id="timezone" name="timezone">${US_TIMEZONES.map((z) => `<option value="${z.id}"${(values ? values.timezone === z.id : b.timezone === z.id) ? " selected" : ""}>${esc(z.label)}</option>`).join("")}</select></div>
    <div class="field"><label for="leadHours">Earliest booking</label>${sel("leadHours", LEAD_HOUR_CHOICES, b.leadHours, (n) => (n === 0 ? "Any time from now" : `${n} hour${n === 1 ? "" : "s"} from now`))}</div>
    <div class="field"><label for="daysAhead">How far ahead</label>${sel("daysAhead", DAYS_AHEAD_CHOICES, b.daysAhead, (n) => `Up to ${n} days`)}</div>
  </div>
</fieldset>
<fieldset><legend>Google reviews</legend>
  <div class="field"><label for="reviewLink">Your Google review link <span class="hint">Paste the "Ask for reviews" link from your Google Business Profile, or your Google Place ID.</span></label><input type="text" id="reviewLink" name="reviewLink" maxlength="500" autocomplete="off" spellcheck="false" value="${val("reviewLink", reviewUrl ?? "")}" placeholder="https://g.page/r/...">${err("reviewLink")}</div>
  <div class="row">
    <div class="field"><label for="googleRating">Your Google rating <span class="hint">Optional. Shown on your website as you type it.</span></label><input type="text" id="googleRating" name="googleRating" inputmode="decimal" maxlength="3" value="${val("googleRating", site.googleRating ? String(site.googleRating.rating) : "")}" placeholder="4.8"></div>
    <div class="field"><label for="googleCount">Number of Google reviews <span class="hint">Optional</span></label><input type="text" id="googleCount" name="googleCount" inputmode="numeric" maxlength="9" value="${val("googleCount", site.googleRating?.count != null ? String(site.googleRating.count) : "")}" placeholder="120"></div>
  </div>${err("googleRating")}
  ${
    reviewUrl
      ? `<p class="hint">Your review page: <a href="${esc(reviewPage)}" target="_blank" rel="noopener">${esc(reviewPage.replace(/^https?:\/\//, ""))}</a>. Share it with happy customers, or <a href="${esc(cardHref)}" target="_blank" rel="noopener">print a card with a QR code</a>.</p>`
      : `<p class="hint">Add your link to get a review page and a printable QR card.</p>`
  }
</fieldset>
<div class="buttons"><button class="btn" type="submit">Save bookings &amp; reviews</button></div>
</form>
</section>`;
}

/** The owner's printable review card (white, print-friendly, no SiteVault chrome). */
export function reviewCardPage(site: Site, reviewPage: string, qr: string, nonce: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Review card — SiteVault</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#f4f4f5;color:#111827}
main{max-width:720px;margin:0 auto;padding:24px 16px}
.tools{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 20px}
.tools button,.tools a{min-height:44px;display:inline-flex;align-items:center;padding:10px 18px;border-radius:10px;font:inherit;font-weight:700;text-decoration:none;border:1px solid #111827;background:#111827;color:#fff;cursor:pointer}
.tools a.ghost{background:#fff;color:#111827}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:32px 24px;text-align:center;max-width:420px;margin:0 auto}
.card h1{font-size:1.6rem;margin:0 0 6px}
.card p{margin:0 0 18px;font-size:1.15rem;color:#374151}
.card svg{width:240px;height:240px;max-width:100%}
.card .url{font-size:.95rem;color:#4b5563;word-break:break-all;margin:12px 0 0}
@media print{body{background:#fff}.tools{display:none}main{padding:0}.card{border:2px solid #111827;margin-top:24px}}
</style></head>
<body><main>
<div class="tools"><button type="button" id="print">Print this card</button><a class="ghost" href="${esc(reviewPage)}" target="_blank" rel="noopener">Open the review page</a></div>
<div class="card">
<h1>${esc(site.businessName)}</h1>
<p>Enjoyed your visit? Leave us a review</p>
${qr}
<p class="url">${esc(reviewPage.replace(/^https?:\/\//, ""))}</p>
</div>
<p style="text-align:center;color:#6b7280;font-size:.9rem;margin-top:16px">Scan with a phone camera. It opens your review page, which takes customers to Google.</p>
</main>
<script nonce="${esc(nonce)}">document.getElementById('print').addEventListener('click',function(){window.print();});</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Owner: requests on /account

const KIND_LABEL: Record<LeadKind, string> = { quote: "Quote", callback: "Call back", booking: "Booking" };
const STATUS_LABEL: Record<string, string> = {
  new: "New",
  requested: "Waiting for you",
  contacted: "Contacted",
  confirmed: "Confirmed",
  declined: "Declined",
  done: "Done",
};

const FLASH: Record<string, string> = {
  ok: "Done.",
  asked: "Review request sent.",
  already: "You've already asked this customer for a review.",
  failed: "That didn't go through. Please try again in a minute.",
  nolink: "Add your Google review link first (edit your website, Bookings & reviews).",
};

/** The "Requests" section for one site on /account. `leads` null = AdVault couldn't be reached. */
export function leadsSection(site: { slug: string; businessName: string }, leads: Lead[] | null, opts: { reviewUrl: string | null; flash?: string }): string {
  const slug = site.slug;
  const act = (id: string, path: "status" | "review-request", label: string, extra: Record<string, string>, ghost = true) =>
    `<form method="post" action="/account/leads/${encodeURIComponent(id)}/${path}" style="display:inline">${hidden("slug", slug)}${Object.entries(extra)
      .map(([k, v]) => hidden(k, v))
      .join("")}<button class="btn${ghost ? " ghost" : ""} small" type="submit">${esc(label)}</button></form>`;
  const card = (l: Lead) => {
    const buttons: string[] = [];
    if (l.kind === "booking" && (l.status === "requested" || l.status === "new")) {
      buttons.push(act(l.id, "status", "Confirm", { status: "confirmed" }, false), act(l.id, "status", "Decline", { status: "declined" }));
    } else if (l.status === "new") buttons.push(act(l.id, "status", "Mark contacted", { status: "contacted" }));
    if (l.status !== "done" && l.status !== "declined" && !(l.kind === "booking" && (l.status === "requested" || l.status === "new")))
      buttons.push(act(l.id, "status", "Mark done", { status: "done" }));
    if (opts.reviewUrl && l.email && l.status !== "declined") buttons.push(act(l.id, "review-request", "Ask for a review", {}));
    const src = l.source ? [l.source.utmSource, l.source.utmCampaign, l.source.referrerHost].filter(Boolean).join(" · ") : "";
    return `<li class="notice" style="margin:10px 0;list-style:none">
<p style="margin:0 0 6px"><strong>${esc(KIND_LABEL[l.kind])}</strong> · ${esc(STATUS_LABEL[l.status] ?? l.status)}${l.createdAt ? ` · <span class="hint">${esc(new Date(l.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: l.booking?.timezone ?? "America/New_York" }))}</span>` : ""}</p>
<p style="margin:0 0 6px">${esc(l.name)} · <a href="${esc(telHref(l.phone))}">${esc(l.phone)}</a>${l.email ? ` · <a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}</p>
${l.booking ? `<p style="margin:0 0 6px">${esc(l.booking.service)}, ${esc(bookingWhen(l.booking.start, l.booking.timezone))} (${l.booking.durationMin} min)</p>` : ""}
${l.bestTime ? `<p class="hint" style="margin:0 0 6px">Best time: ${esc(l.bestTime)}</p>` : ""}
${l.message ? `<p class="hint" style="margin:0 0 6px;white-space:pre-wrap">${esc(l.message)}</p>` : ""}
${l.photoUrls.length ? `<p style="margin:0 0 6px">${l.photoUrls.filter((u) => /^https:\/\//.test(u)).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">Photo ${i + 1}</a>`).join(" · ")}</p>` : ""}
${src ? `<p class="hint" style="margin:0 0 6px">Came from: ${esc(src)}</p>` : ""}
${buttons.length ? `<div class="buttons">${buttons.join(" ")}</div>` : ""}
</li>`;
  };
  const flash = opts.flash && FLASH[opts.flash] ? `<p class="notice${opts.flash === "failed" || opts.flash === "nolink" ? "" : " ok"}" role="status">${esc(FLASH[opts.flash])}</p>` : "";
  return `<section id="leads" style="margin-top:24px" aria-labelledby="leads-h">
<h2 id="leads-h">Requests from your website</h2>
${flash}
${
  leads === null
    ? `<p class="hint">We couldn't load your requests right now. They're safe; try again in a minute. We also email you each one.</p>`
    : leads.length
      ? `<ul style="padding:0;margin:0">${leads.map(card).join("")}</ul>`
      : `<p class="hint">No requests yet. Quotes, call-backs and bookings from your website show up here, and we email you each one.</p>`
}
</section>`;
}
