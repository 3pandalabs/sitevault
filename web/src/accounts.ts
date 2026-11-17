// Owner accounts (2026-11-15): email + password, so an owner can sign in and
// manage their websites without the secret edit link (which still works).
// Storage is KV, like everything else here:
//   acct:<id>            Account JSON
//   acctemail:<email>    -> account id (email is the login, unique)
//   sess:<sha256(token)> -> account id, expires after SESSION_DAYS
// The session cookie lives on the main site only (sitevault.3pandalabs.com).
// Customer sites (<slug>.3pandasite.com) never see or set a cookie.
//
// One 3PandaLabs account (2026-11-16): the LOGIN lives in AdVault's users
// table, shared by AdVault and SiteVault. This KV record keeps SiteVault's own
// part (sites, sessions) and links to it by advaultUserId.
//   - New sign-ups create the shared account first (signUpShared); pw stays
//     null here and /login checks the password with AdVault.
//   - Older SiteVault-only accounts (pw set, no advaultUserId) move lazily on
//     their next successful SiteVault-password sign-in (moveToSharedAccount).
//   - SiteVault tells AdVault when an account starts using SiteVault (first
//     website) so AdVault can tell SiteVault-only customers apart.
// If AdVault is unreachable, sign-up falls back to a local password and the
// account moves on a later sign-in; nothing here ever blocks on AdVault
// except checking a password only AdVault holds.

import { randomKey, safeEqual, sha256Hex } from "./util.js";

export type Account = {
  id: string;
  email: string;
  /** PBKDF2-SHA256. null when the password lives in the shared 3PandaLabs account (AdVault). */
  pw: { hash: string; salt: string; iter: number } | null;
  /** The shared 3PandaLabs account (AdVault user id) this account belongs to. */
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
const advKey = (userId: string) => `acctadv:${userId}`;

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailProblem(email: string): string | null {
  if (!email) return "Enter your email.";
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return "That doesn't look like an email address.";
  return null;
}

export function passwordProblem(pw: string): string | null {
  // 10, the shared 3PandaLabs account rule (AdVault's). Older accounts made
  // with 8 still sign in everywhere.
  if (pw.length < 10) return "Use at least 10 characters.";
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
  if (a.advaultUserId) await kv.put(advKey(a.advaultUserId), a.id);
}

/**
 * The SiteVault account for an AdVault user (same login on both): found by
 * AdVault user id, else by email (and linked), else created with no
 * SiteVault password (they sign in with their AdVault password).
 */
export async function accountForAdvault(kv: KVNamespace, user: { advaultUserId: string; email: string }): Promise<Account> {
  const byAdv = await kv.get(advKey(user.advaultUserId));
  const linked = byAdv ? await loadAccount(kv, byAdv) : null;
  if (linked) return linked;
  const email = normaliseEmail(user.email);
  const byEmail = await accountByEmail(kv, email);
  if (byEmail) {
    const next = { ...byEmail, advaultUserId: user.advaultUserId };
    await saveAccount(kv, next);
    return next;
  }
  const made = await createAccount(kv, email, null, { advaultUserId: user.advaultUserId });
  // A race with another create for the same email: use whichever won.
  return made === "exists" ? ((await accountByEmail(kv, email)) as Account) : made;
}

/**
 * Read-only twin of accountForAdvault: the linked account (by AdVault user id,
 * else by the same email), or null. Never creates or links anything.
 */
export async function findAccountForAdvault(kv: KVNamespace, user: { advaultUserId: string; email?: string | null }): Promise<Account | null> {
  const byAdv = await kv.get(advKey(user.advaultUserId));
  const linked = byAdv ? await loadAccount(kv, byAdv) : null;
  if (linked) return linked;
  const email = normaliseEmail(user.email ?? "");
  return email && !emailProblem(email) ? accountByEmail(kv, email) : null;
}

/** Ask AdVault whether this is a valid AdVault login (server to server). */
export async function verifyAdvaultLogin(
  apiUrl: string | undefined,
  token: string | undefined,
  email: string,
  password: string,
): Promise<{ advaultUserId: string; email: string } | null> {
  if (!apiUrl || !token || !email || !password) return null;
  try {
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/internal/sitevault/verify-login`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; userId?: string; email?: string };
    return body.ok && body.userId && body.email ? { advaultUserId: body.userId, email: body.email } : null;
  } catch (err) {
    console.warn("advault login check failed", String(err));
    return null;
  }
}

type AdvaultApi = { apiUrl: string | undefined; token: string | undefined };

/** POST to an AdVault internal route; null on any failure (unconfigured, down, timeout). */
async function advaultPost(api: AdvaultApi, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (!api.apiUrl || !api.token) return null;
  try {
    const res = await fetch(`${api.apiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${api.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch (err) {
    console.warn("advault call failed", path, String(err));
    return null;
  }
}

export type SharedCreate = { kind: "created" | "exists"; advaultUserId: string } | null;

/**
 * Create the shared 3PandaLabs account in AdVault (signup_app = sitevault).
 * "exists" carries the existing account's id and changes nothing on it.
 * null = AdVault unavailable or refused (caller falls back).
 */
export async function createAdvaultAccount(
  api: AdvaultApi,
  input: { email: string; password: string; createdAt?: string; sitevaultUsedAt?: string },
): Promise<SharedCreate> {
  const r = await advaultPost(api, "/internal/sitevault/accounts", input);
  const id = typeof r?.body.userId === "string" ? r.body.userId : null;
  if (r?.status === 201 && id) return { kind: "created", advaultUserId: id };
  if (r?.status === 409 && r.body.error === "email_exists" && id) return { kind: "exists", advaultUserId: id };
  if (r) console.warn("advault account create refused", { status: r.status, error: r.body.error });
  return null;
}

/** Tell AdVault this account uses SiteVault (has a website). Idempotent; never throws. */
export async function markSitevaultUsed(api: AdvaultApi, advaultUserId: string | null | undefined, at?: string): Promise<boolean> {
  if (!advaultUserId) return false;
  const r = await advaultPost(api, "/internal/sitevault/usage", at ? { userId: advaultUserId, at } : { userId: advaultUserId });
  return r?.status === 200;
}

/**
 * Sign up with the shared 3PandaLabs account. "exists" when the email already
 * has a SiteVault account or a 3PandaLabs (AdVault) account: sign in instead.
 * When AdVault can't be reached the account is made here with a local
 * password and moves to the shared account on a later sign-in.
 */
export async function signUpShared(kv: KVNamespace, api: AdvaultApi, email: string, password: string): Promise<Account | "exists"> {
  if (await kv.get(emailKey(email))) return "exists";
  const shared = await createAdvaultAccount(api, { email, password });
  if (shared?.kind === "exists") return "exists";
  if (shared?.kind === "created") return createAccount(kv, email, null, { advaultUserId: shared.advaultUserId });
  console.warn("shared account unavailable, local sign-up");
  return createAccount(kv, email, password);
}

/**
 * Lazy move of a SiteVault-only account to the shared 3PandaLabs account,
 * right after its SiteVault password was verified (so `password` is proven).
 *   - created: AdVault now holds the password; the local copy is dropped.
 *   - exists (email already in AdVault): linked, AdVault's password untouched,
 *     and the local password kept so this person can still sign in here.
 *   - AdVault unavailable: unchanged; tried again next sign-in.
 * Keeps the account's createdAt; sitevaultUsedAt stamps its first website.
 */
export async function moveToSharedAccount(
  kv: KVNamespace,
  api: AdvaultApi,
  account: Account,
  password: string,
  sitevaultUsedAt?: string,
): Promise<Account> {
  if (account.advaultUserId) return account;
  const shared = await createAdvaultAccount(api, {
    email: account.email,
    password,
    createdAt: account.createdAt,
    ...(sitevaultUsedAt ? { sitevaultUsedAt } : {}),
  });
  if (!shared) return account;
  // Never take over an AdVault id another SiteVault account is linked to.
  const holder = await kv.get(advKey(shared.advaultUserId));
  if (holder && holder !== account.id) {
    console.warn("shared account already linked elsewhere", { account: account.id, holder });
    return account;
  }
  const next: Account = { ...account, advaultUserId: shared.advaultUserId, pw: shared.kind === "created" ? null : account.pw };
  await saveAccount(kv, next);
  console.log("account_moved_to_shared", { id: account.id, kind: shared.kind });
  return next;
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
