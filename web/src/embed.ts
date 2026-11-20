// Embedded editor (2026-11-19, "Option A"): AdVault shows THIS Worker's edit
// page inside its own dashboard ("Your website"), so an AdVault customer edits
// their AdVault-made site without leaving AdVault or seeing a sign-in form.
//
// Sign-in handoff: AdVault's API mints a short-lived, single-use token for the
// signed-in AdVault user and their site:
//
//   token   = <payload>.<sig>
//   payload = base64url(JSON { v: 1, uid, email, slug, iat, exp, jti })
//   sig     = base64url(HMAC-SHA256(key = INTERNAL_TOKEN, "sv-embed-v1." + payload))
//
// The "sv-embed-v1." prefix keeps this MAC from ever matching anything else
// signed with the same shared secret. GET /embed/session?token= checks it
// here (pure, below), then index.ts checks single use (KV), that the account
// owns the AdVault-made site, sets the normal session cookie and redirects to
// /edit/<slug>?embed=1. No password or long-lived secret is ever in a URL.

/** The only page allowed to frame the embedded editor. */
export const EMBED_PARENT_ORIGIN = "https://advault.3pandalabs.com";
/** Longest life a handoff token may have (AdVault mints them with 60 s). */
export const HANDOFF_MAX_AGE_SECONDS = 60;
/** Small allowance for clock drift between the AdVault box and Cloudflare. */
export const HANDOFF_CLOCK_SKEW_SECONDS = 5;
/** KV `embedjti:<jti>` lives this long (KV's minimum TTL is 60 s). */
export const HANDOFF_JTI_TTL_SECONDS = 120;

const PREFIX = "sv-embed-v1.";

export type Handoff = { v: 1; uid: string; email: string; slug: string; iat: number; exp: number; jti: string };

export type HandoffCheck = { ok: true; handoff: Handoff } | { ok: false; error: "malformed" | "bad_signature" | "expired" | "not_configured" };

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Mint a token (AdVault does this in Node; here for tests and as the reference). */
export async function signHandoff(secret: string, h: Handoff): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(h)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(PREFIX + payload));
  return `${payload}.${b64url(sig)}`;
}

/**
 * Signature (constant time, via WebCrypto verify), shape and lifetime. Single
 * use and ownership are the caller's (they need KV).
 */
export async function verifyHandoff(secret: string | undefined, token: string, nowMs = Date.now()): Promise<HandoffCheck> {
  if (!secret) return { ok: false, error: "not_configured" };
  if (token.length > 2048) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "malformed" };
  const [payload, sigText] = parts as [string, string];
  const sig = fromB64url(sigText);
  if (!payload || !sig) return { ok: false, error: "malformed" };
  const good = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, enc.encode(PREFIX + payload));
  if (!good) return { ok: false, error: "bad_signature" };
  let h: Partial<Handoff>;
  try {
    const raw = fromB64url(payload);
    h = raw ? (JSON.parse(new TextDecoder().decode(raw)) as Partial<Handoff>) : {};
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (
    h.v !== 1 ||
    typeof h.uid !== "string" ||
    !/^[A-Za-z0-9-]{8,64}$/.test(h.uid) ||
    typeof h.email !== "string" ||
    h.email.length > 200 ||
    typeof h.slug !== "string" ||
    !/^[a-z0-9-]{1,63}$/.test(h.slug) ||
    typeof h.jti !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(h.jti) ||
    !Number.isInteger(h.iat) ||
    !Number.isInteger(h.exp)
  ) {
    return { ok: false, error: "malformed" };
  }
  const now = Math.floor(nowMs / 1000);
  const iat = h.iat as number;
  const exp = h.exp as number;
  // Short-lived only: never longer than 60 s, never from the future, never past exp.
  if (exp - iat > HANDOFF_MAX_AGE_SECONDS || iat > now + HANDOFF_CLOCK_SKEW_SECONDS || now >= exp) {
    return { ok: false, error: "expired" };
  }
  return { ok: true, handoff: h as Handoff };
}

/**
 * Let AdVault frame this response (embed mode only). Every other page keeps
 * `frame-ancestors 'none'`.
 */
export function allowEmbedFraming(res: Response): Response {
  const csp = res.headers.get("content-security-policy");
  if (csp) res.headers.set("content-security-policy", csp.replace("frame-ancestors 'none'", `frame-ancestors ${EMBED_PARENT_ORIGIN}`));
  return res;
}

/**
 * The embedded edit page tells AdVault its height (so the iframe fits, no
 * inner scrollbar) and when a save landed. Messages go ONLY to AdVault's
 * origin (postMessage targetOrigin), so another framer learns nothing; it
 * does nothing when not framed. It also says where the "Website style"
 * picker starts in the page (`sitevault:sections`, px from the top), so
 * AdVault can scroll its page to it right after a site is made.
 */
export const EMBED_SCRIPT = `
(function(){
  if(window.parent===window) return;
  var P=${JSON.stringify(EMBED_PARENT_ORIGIN)}, last=0;
  function send(){ var h=Math.ceil(document.documentElement.scrollHeight); if(h!==last){ last=h; window.parent.postMessage({type:'sitevault:height',height:h},P); } }
  send(); window.addEventListener('load',send);
  if(window.ResizeObserver) new ResizeObserver(send).observe(document.body); else setInterval(send,1000);
  document.addEventListener('toggle',send,true);
  function sections(){ var s=document.getElementById('website-style'); if(s) window.parent.postMessage({type:'sitevault:sections',style:Math.round(s.getBoundingClientRect().top+window.scrollY)},P); }
  if(document.readyState==='complete') sections(); else window.addEventListener('load',sections);
  var saved=document.getElementById('embed-saved');
  if(saved) window.parent.postMessage({type:'sitevault:saved',slug:saved.getAttribute('data-slug'),siteUrl:saved.getAttribute('data-site-url')},P);
})();`;
