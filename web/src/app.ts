// Android app (Play TWA): payments on the website only.
//
// TODO(android-payments): TEMPORARY (owner decision 2026-11-26, US-only Play
// launch). Google Play's US rules make taking Stripe payments inside the app,
// or linking out to a payment page, need a Google program and a ~10% fee. So
// inside the app there is NO way to start a payment and NO link to one; people
// pay on the website in a normal browser. Revisit Play alternative billing at
// 10%. See CLAUDE.md "Android app: payments on the website only".
//
// How it works:
// - Pages mark payment UI with payOnly() (replaced by APP_PAYMENTS_MESSAGE) or
//   payDrop() (removed). Outside the app the markers are just HTML comments.
// - The Worker's fetch wrapper (index.ts withAppMode) runs stripPayments() on
//   every main-host HTML response that isAppRequest(), so payment buttons are
//   never sent to the app. Checkout/portal POSTs are refused there too.
// - In the app = ?source=twa (the TWA's startUrl), a Referer from
//   android-app://com.threepandalabs.sitevault, or the sv_app session cookie
//   set when either was seen.
// - A TWA shares Chrome's cookie jar, so the cookie can leak into a normal
//   Chrome tab. APP_MODE_SCRIPT (injected only into app-mode pages) keeps a
//   per-tab sessionStorage flag: a tab with no app signal clears the cookie
//   and reloads, so the browser shows payments again.

export const APP_PACKAGE = "com.threepandalabs.sitevault";
export const APP_REFERRER = `android-app://${APP_PACKAGE}`;
export const APP_COOKIE = "sv_app";
/** Session cookie (no Max-Age), readable by APP_MODE_SCRIPT so it can clear it. Holds no ID. */
export const APP_COOKIE_SET = `${APP_COOKIE}=1; Path=/; Secure; SameSite=Lax`;

/** The ONE wording shown in the app where a payment option would be. No link, no URL. */
export const APP_PAYMENTS_MESSAGE = "Payments aren't available in the app. To upgrade or manage your plan, sign in on our website from any browser.";

const PAY = ["<!--sv-pay-->", "<!--/sv-pay-->"] as const;
const DROP = ["<!--sv-pay-drop-->", "<!--/sv-pay-drop-->"] as const;
const NOTE = "<!--sv-pay-note-->";

/** Payment UI: replaced by APP_PAYMENTS_MESSAGE in the app. Never nest. */
export function payOnly(s: string): string {
  return s ? `${PAY[0]}${s}${PAY[1]}` : "";
}

/** Payment-related text or links: removed in the app, no message. Never nest. */
export function payDrop(s: string): string {
  return s ? `${DROP[0]}${s}${DROP[1]}` : "";
}

/** The request itself says it came from the app (sets the cookie). */
export function appSignal(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("source") === "twa") return true;
  return (request.headers.get("referer") ?? "").startsWith(APP_REFERRER);
}

function hasAppCookie(request: Request): boolean {
  return (request.headers.get("cookie") ?? "").split(";").some((c) => c.trim() === `${APP_COOKIE}=1`);
}

export function isAppRequest(request: Request): boolean {
  return appSignal(request) || hasAppCookie(request);
}

const msgHtml = `<p class="hint" data-app-pay-note>${APP_PAYMENTS_MESSAGE.replace(/'/g, "&#39;")}</p>`;

/** The page as the app gets it: every payment option replaced by one message (adjacent ones merged). */
export function stripPayments(page: string): string {
  let out = page
    .replace(/<!--sv-pay-drop-->[\s\S]*?<!--\/sv-pay-drop-->/g, "")
    .replace(/<!--sv-pay-->[\s\S]*?<!--\/sv-pay-->/g, NOTE)
    // Backstop: a payment form or link that missed its markers.
    .replace(/<form\b[^>]*action="[^"]*\/api\/billing\/[^"]*"[\s\S]*?<\/form>/g, NOTE)
    .replace(/<a\b[^>]*href="[^"]*(?:checkout\.stripe\.com|billing\.stripe\.com|buy\.stripe\.com|siteOffer=)[^"]*"[\s\S]*?<\/a>/g, "");
  out = out.replace(/<!--sv-pay-note-->(?:\s*<!--sv-pay-note-->)+/g, NOTE);
  return out.split(NOTE).join(msgHtml);
}

/**
 * Runs in app-mode pages only. In the app (URL, referrer or this tab's flag):
 * remember it for the tab. Not in the app (a normal Chrome tab that got the
 * shared cookie): clear the cookie and load the page again with payments.
 * An installed PWA window (display-mode standalone) is left as is.
 */
export const APP_MODE_SCRIPT = `(function(){try{var s=window.sessionStorage,k='${APP_COOKIE}';
var inApp=/[?&]source=twa(&|$)/.test(location.search)||document.referrer.indexOf('${APP_REFERRER}')===0||s.getItem(k)==='1';
if(inApp){s.setItem(k,'1');document.cookie='${APP_COOKIE_SET}';return;}
if(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)return;
if(s.getItem(k+'_cleared'))return;s.setItem(k+'_cleared','1');
document.cookie='${APP_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax';
location.replace(document.querySelector('[data-app-blocked]')?(document.referrer||'/'):location.href);
}catch(e){}})();`;

/** Adds the script (with its own nonce in the CSP) and the app marker to an app-mode page. */
export function appModePage(page: string, csp: string | null, nonce: string): { page: string; csp: string | null } {
  let out = stripPayments(page).replace(/<html\b([^>]*)>/i, (m, a: string) => (a.includes("data-sv-app") ? m : `<html${a} data-sv-app>`));
  out = out.replace(/<head>/i, `<head>\n<script nonce="${nonce}">${APP_MODE_SCRIPT}</script>`);
  let policy = csp;
  if (policy) {
    if (/script-src 'none'/.test(policy)) policy = policy.replace(/script-src 'none'/, `script-src 'nonce-${nonce}'`);
    else if (/script-src /.test(policy)) policy = policy.replace(/script-src /, `script-src 'nonce-${nonce}' `);
  }
  return { page: out, csp: policy };
}
