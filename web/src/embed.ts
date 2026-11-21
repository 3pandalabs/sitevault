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

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
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

export async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Mint a token (AdVault does this in Node; here for tests and as the reference). */
export async function signHandoff(secret: string, h: Handoff): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(h)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(PREFIX + payload));
  return `${payload}.${b64url(sig)}`;
}

/**
 * Signature (constant time, via WebCrypto verify) under `prefix`, then the
 * decoded payload. Shape and lifetime are the typed verifiers' job.
 */
export async function verifySigned(secret: string, token: string, prefix: string): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; error: "malformed" | "bad_signature" }> {
  if (token.length > 2048) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "malformed" };
  const [payload, sigText] = parts as [string, string];
  const sig = fromB64url(sigText);
  if (!payload || !sig) return { ok: false, error: "malformed" };
  const good = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, enc.encode(prefix + payload));
  if (!good) return { ok: false, error: "bad_signature" };
  try {
    const raw = fromB64url(payload);
    const h = raw ? (JSON.parse(new TextDecoder().decode(raw)) as unknown) : null;
    return h && typeof h === "object" && !Array.isArray(h) ? { ok: true, payload: h as Record<string, unknown> } : { ok: false, error: "malformed" };
  } catch {
    return { ok: false, error: "malformed" };
  }
}

/** Short-lived only: never longer than 60 s, never from the future, never past exp. */
function lifetimeOk(iat: number, exp: number, nowMs: number): boolean {
  const now = Math.floor(nowMs / 1000);
  return !(exp - iat > HANDOFF_MAX_AGE_SECONDS || iat > now + HANDOFF_CLOCK_SKEW_SECONDS || now >= exp);
}

const UID = /^[A-Za-z0-9-]{8,64}$/;
const JTI = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Signature (constant time, via WebCrypto verify), shape and lifetime. Single
 * use and ownership are the caller's (they need KV).
 */
export async function verifyHandoff(secret: string | undefined, token: string, nowMs = Date.now()): Promise<HandoffCheck> {
  if (!secret) return { ok: false, error: "not_configured" };
  const signed = await verifySigned(secret, token, PREFIX);
  if (!signed.ok) return signed;
  const h = signed.payload as Partial<Handoff>;
  if (
    h.v !== 1 ||
    typeof h.uid !== "string" ||
    !UID.test(h.uid) ||
    typeof h.email !== "string" ||
    h.email.length > 200 ||
    typeof h.slug !== "string" ||
    !/^[a-z0-9-]{1,63}$/.test(h.slug) ||
    typeof h.jti !== "string" ||
    !JTI.test(h.jti) ||
    !Number.isInteger(h.iat) ||
    !Number.isInteger(h.exp)
  ) {
    return { ok: false, error: "malformed" };
  }
  if (!lifetimeOk(h.iat as number, h.exp as number, nowMs)) return { ok: false, error: "expired" };
  return { ok: true, handoff: h as Handoff };
}

// ---------------------------------------------------------------------------
// AdVault create mode (2026-11-19): AdVault's "Make me a website" frames THIS
// Worker's full builder, pre-filled from the campaign. A separate token type:
//
//   token   = <payload>.<sig>
//   payload = base64url(JSON { v: 1, purpose: "create", uid, email, campaignId, draft, pay, iat, exp, jti })
//   sig     = base64url(HMAC-SHA256(key = INTERNAL_TOKEN, "sv-embed-create-v1." + payload))
//
// A different MAC prefix AND an explicit purpose, so an edit token can never
// open the create builder and a create token can never sign in to an editor.
// `draft` names the pre-fill AdVault stored here first, server to server
// (POST /api/internal/drafts); the token carries only its id, never the data.

const CREATE_PREFIX = "sv-embed-create-v1.";

export type CreateHandoff = {
  v: 1;
  purpose: "create";
  uid: string;
  email: string;
  campaignId: string;
  /** The pre-fill draft id (POST /api/internal/drafts). */
  draft: string;
  /** AdVault charges the $10 first: the site is made unpublished (pending). */
  pay: boolean;
  iat: number;
  exp: number;
  jti: string;
};

export type CreateHandoffCheck = { ok: true; handoff: CreateHandoff } | { ok: false; error: "malformed" | "bad_signature" | "expired" | "not_configured" };

/** Mint a create token (AdVault does this in Node; here for tests and as the reference). */
export async function signCreateHandoff(secret: string, h: CreateHandoff): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(h)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(CREATE_PREFIX + payload));
  return `${payload}.${b64url(sig)}`;
}

/** Draft ids: random, url-safe (`randomKey`). */
export const DRAFT_ID = /^[A-Za-z0-9_-]{16,64}$/;

export async function verifyCreateHandoff(secret: string | undefined, token: string, nowMs = Date.now()): Promise<CreateHandoffCheck> {
  if (!secret) return { ok: false, error: "not_configured" };
  const signed = await verifySigned(secret, token, CREATE_PREFIX);
  if (!signed.ok) return signed;
  const h = signed.payload as Partial<CreateHandoff>;
  if (
    h.v !== 1 ||
    h.purpose !== "create" ||
    typeof h.uid !== "string" ||
    !UID.test(h.uid) ||
    typeof h.email !== "string" ||
    h.email.length > 200 ||
    typeof h.campaignId !== "string" ||
    !UID.test(h.campaignId) ||
    typeof h.draft !== "string" ||
    !DRAFT_ID.test(h.draft) ||
    typeof h.pay !== "boolean" ||
    typeof h.jti !== "string" ||
    !JTI.test(h.jti) ||
    !Number.isInteger(h.iat) ||
    !Number.isInteger(h.exp)
  ) {
    return { ok: false, error: "malformed" };
  }
  if (!lifetimeOk(h.iat as number, h.exp as number, nowMs)) return { ok: false, error: "expired" };
  return { ok: true, handoff: h as CreateHandoff };
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
 * does nothing when not framed. The create builder's "Created" page sends
 * `sitevault:created` { slug, siteUrl, pending, draft } the same way. It also says where the "Website style"
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
  var made=document.getElementById('embed-created');
  if(made) window.parent.postMessage({type:'sitevault:created',slug:made.getAttribute('data-slug'),siteUrl:made.getAttribute('data-site-url'),pending:made.getAttribute('data-pending')==='1',draft:made.getAttribute('data-draft')},P);
})();`;
