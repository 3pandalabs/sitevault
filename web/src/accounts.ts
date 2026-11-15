// Owner accounts (2026-11-15): email + password, so an owner can sign in and
// manage their websites without the secret edit link (which still works).
// Storage is KV, like everything else here:
//   acct:<id>            Account JSON
//   acctemail:<email>    -> account id (email is the login, unique)
//   sess:<sha256(token)> -> account id, expires after SESSION_DAYS
// The session cookie lives on the main site only (sitevault.3pandalabs.com).
// Customer sites (<slug>.3pandasite.com) never see or set a cookie.

import { randomKey, safeEqual, sha256Hex } from "./util.js";

export type Account = {
  id: string;
  email: string;
  /** PBKDF2-SHA256. null for an account made by AdVault single sign-in (no password yet). */
  pw: { hash: string; salt: string; iter: number } | null;
  /** The AdVault user this account belongs to (sign in with AdVault). */
  advaultUserId?: string | null;
  /** Slugs of the websites this account owns. */
  sites: string[];
  createdAt: string;
};

export const SESSION_DAYS = 30;
export const COOKIE = "sv_session";
/** Workers' PBKDF2 tops out at 100,000 iterations. */
export const PBKDF2_ITER = 100_000;

const acctKey = (id: string) => `acct:${id}`;
const emailKey = (email: string) => `acctemail:${email}`;
const sessKey = (hash: string) => `sess:${hash}`;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailProblem(email: string): string | null {
  if (!email) return "Enter your email.";
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "That doesn't look like an email address.";
  return null;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 200) return "That password is too long.";
  return null;
}

const b64 = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pbkdf2(password: string, salt: string, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: iter },
    key,
    256,
  );
  return b64(bits);
}

export async function hashPassword(password: string, iter = PBKDF2_ITER): Promise<NonNullable<Account["pw"]>> {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { hash: await pbkdf2(password, salt, iter), salt, iter };
}

export async function verifyPassword(password: string, pw: Account["pw"]): Promise<boolean> {
  if (!pw) return false;
  return safeEqual(await pbkdf2(password, pw.salt, pw.iter), pw.hash);
}

/** The session token from a Cookie header, or null. */
export function sessionToken(cookieHeader: string | null): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) {
      const t = v.join("=");
      return /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
    }
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// ---------------------------------------------------------------------------
// KV

export async function loadAccount(kv: KVNamespace, id: string): Promise<Account | null> {
  return kv.get<Account>(acctKey(id), "json");
}

export async function accountByEmail(kv: KVNamespace, email: string): Promise<Account | null> {
  const id = await kv.get(emailKey(email));
  return id ? loadAccount(kv, id) : null;
}

export async function saveAccount(kv: KVNamespace, a: Account): Promise<void> {
  await kv.put(acctKey(a.id), JSON.stringify(a));
  await kv.put(emailKey(a.email), a.id);
}

/** A new account, or "exists" when the email already has one. */
export async function createAccount(
  kv: KVNamespace,
  email: string,
  password: string | null,
  extra: Partial<Pick<Account, "advaultUserId">> = {},
): Promise<Account | "exists"> {
  if (await kv.get(emailKey(email))) return "exists";
  const a: Account = {
    id: randomKey(12),
    email,
    pw: password ? await hashPassword(password) : null,
    sites: [],
    createdAt: new Date().toISOString(),
    ...extra,
  };
  await saveAccount(kv, a);
  return a;
}

export async function startSession(kv: KVNamespace, accountId: string): Promise<string> {
  const token = randomKey(32);
  await kv.put(sessKey(await sha256Hex(token)), accountId, { expirationTtl: SESSION_DAYS * 86400 });
  return token;
}

export async function endSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(sessKey(await sha256Hex(token)));
}

/** The signed-in account for this request, or null. */
export async function currentAccount(kv: KVNamespace, request: Request): Promise<Account | null> {
  const token = sessionToken(request.headers.get("cookie"));
  if (!token) return null;
  const id = await kv.get(sessKey(await sha256Hex(token)));
  return id ? loadAccount(kv, id) : null;
}

/** Add a site to an account (idempotent). The caller sets site.ownerId. */
export async function addSiteToAccount(kv: KVNamespace, a: Account, slug: string): Promise<Account> {
  if (a.sites.includes(slug)) return a;
  const next = { ...a, sites: [...a.sites, slug] };
  await saveAccount(kv, next);
  return next;
}

/** POSTs that act on a session must come from our own pages (CSRF backstop to SameSite=Lax). */
export function sameOrigin(request: Request, origin: string): boolean {
  const o = request.headers.get("origin");
  return o === null ? false : o === origin;
}
