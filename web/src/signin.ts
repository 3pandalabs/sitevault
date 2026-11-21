// One-tap sign-in between SiteVault and AdVault (2026-11-20). Both apps share
// ONE 3PandaLabs account (the login lives in AdVault; this Worker's KV account
// links to it by advaultUserId), so a person signed in on one app can follow a
// link to the other and arrive signed in, with no password prompt.
//
//   token   = <payload>.<sig>
//   payload = base64url(JSON { v: 1, purpose, uid, email, iat, exp, nonce })
//   sig     = base64url(HMAC-SHA256(key = INTERNAL_TOKEN, "3pl-signin-v1." + payload))
//
//   purpose "signin-advault"    minted HERE by GET /go/advault, checked by
//                               AdVault POST /auth/handoff (its /auth/handoff page)
//   purpose "signin-sitevault"  minted by AdVault POST /auth/sitevault-handoff,
//                               checked HERE by GET /auth/handoff
//
// The same shared secret as the internal API and the embed handoffs, but its
// own MAC prefix AND an explicit purpose: an editor token ("sv-embed-v1.") or
// a create token ("sv-embed-create-v1.") can never sign anybody in, and one
// direction's token is refused by the other. 60 s life, single use (KV
// `signinjti:<nonce>` here, a table in AdVault). Admin accounts are refused
// on both sides (admins sign in by hand). Tokens are never logged; no
// password or long-lived secret is ever in a URL.

import { b64url, HANDOFF_CLOCK_SKEW_SECONDS, hmacKey, verifySigned } from "./embed.js";
import { randomKey } from "./util.js";

export const SIGNIN_PREFIX = "3pl-signin-v1.";
export const SIGNIN_TTL_SECONDS = 60;
/** KV `signinjti:<nonce>` lives this long (KV's minimum TTL is 60 s). */
export const SIGNIN_NONCE_TTL_SECONDS = 120;
export const ADVAULT_WEB_ORIGIN = "https://advault.3pandalabs.com";

export type SigninPurpose = "signin-advault" | "signin-sitevault";

export type SigninToken = { v: 1; purpose: SigninPurpose; uid: string; email: string; iat: number; exp: number; nonce: string };

export type SigninCheck =
  | { ok: true; token: SigninToken }
  | { ok: false; error: "not_configured" | "malformed" | "bad_signature" | "wrong_purpose" | "expired" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const enc = new TextEncoder();

export async function signSigninToken(secret: string, t: SigninToken): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(t)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(SIGNIN_PREFIX + payload));
  return `${payload}.${b64url(sig)}`;
}

/** A fresh 60 s token with a random nonce. */
export async function mintSigninToken(secret: string, purpose: SigninPurpose, user: { uid: string; email: string }, nowMs = Date.now()): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  return signSigninToken(secret, { v: 1, purpose, uid: user.uid, email: user.email, iat, exp: iat + SIGNIN_TTL_SECONDS, nonce: randomKey(18) });
}

/** Signature (constant time, WebCrypto verify), shape, purpose, lifetime. Single use and the account are the caller's. */
export async function verifySigninToken(secret: string | undefined, token: string, purpose: SigninPurpose, nowMs = Date.now()): Promise<SigninCheck> {
  if (!secret) return { ok: false, error: "not_configured" };
  const signed = await verifySigned(secret, token, SIGNIN_PREFIX);
  if (!signed.ok) return signed;
  const t = signed.payload as Partial<SigninToken>;
  if (
    t.v !== 1 ||
    typeof t.uid !== "string" ||
    !UUID.test(t.uid) ||
    typeof t.email !== "string" ||
    t.email.length > 254 ||
    typeof t.nonce !== "string" ||
    !NONCE.test(t.nonce) ||
    !Number.isInteger(t.iat) ||
    !Number.isInteger(t.exp)
  ) {
    return { ok: false, error: "malformed" };
  }
  if (t.purpose !== purpose) return { ok: false, error: "wrong_purpose" };
  const now = Math.floor(nowMs / 1000);
  const iat = t.iat as number;
  const exp = t.exp as number;
  if (exp - iat > SIGNIN_TTL_SECONDS || iat > now + HANDOFF_CLOCK_SKEW_SECONDS || now >= exp) return { ok: false, error: "expired" };
  return { ok: true, token: t as SigninToken };
}

/**
 * A relative, same-origin path, or `fallback`: "/..." only, never "//host",
 * "/\host", a scheme or control characters (no open redirect). The character
 * set matches /login's `next` rule, so a refused handoff's `/login?next=`
 * keeps the destination.
 */
export function safeLocalPath(raw: string | null | undefined, fallback: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return fallback;
  if (!/^\/[a-z0-9/_?=&.%#-]*$/i.test(raw) || raw.startsWith("//")) return fallback;
  return raw;
}
