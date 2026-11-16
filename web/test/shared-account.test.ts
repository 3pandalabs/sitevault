// One 3PandaLabs account (AdVault + SiteVault): sign-up through AdVault, the
// lazy move of older SiteVault-only accounts, linking an email AdVault
// already has, and the usage report. AdVault is a stubbed fetch; KV is an
// in-memory map.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountByEmail,
  accountForAdvault,
  createAccount,
  hashPassword,
  markSitevaultUsed,
  moveToSharedAccount,
  signUpShared,
  verifyPassword,
  type Account,
} from "../src/accounts.js";

function memoryKv(): KVNamespace & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(key: string, type?: string) {
      const v = data.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      data.set(key, value);
    },
    async delete(key: string) {
      data.delete(key);
    },
  } as unknown as KVNamespace & { data: Map<string, string> };
}

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[];
let reply: (call: Call) => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    return reply(call);
  });
});
afterEach(() => vi.unstubAllGlobals());

const api = { apiUrl: "https://api-internal.advault.test/", token: "t" };
const ADV_ID = "11111111-2222-3333-4444-555555555555";
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function legacyAccount(kv: KVNamespace, email: string, password: string, extra: Partial<Account> = {}): Promise<Account> {
  const a: Account = { id: "acct1", email, pw: await hashPassword(password, 1000), sites: [], createdAt: "2026-11-15T09:00:00.000Z", ...extra };
  await kv.put(`acct:${a.id}`, JSON.stringify(a));
  await kv.put(`acctemail:${email}`, a.id);
  return a;
}

describe("signUpShared", () => {
  it("creates the shared account in AdVault and stores no password here", async () => {
    const kv = memoryKv();
    reply = () => json({ ok: true, userId: ADV_ID, email: "new@x.test" }, 201);
    const made = await signUpShared(kv, api, "new@x.test", "a long password");
    expect(made).not.toBe("exists");
    const a = made as Account;
    expect(a.pw).toBeNull();
    expect(a.advaultUserId).toBe(ADV_ID);
    expect(calls[0]!.url).toBe("https://api-internal.advault.test/internal/sitevault/accounts");
    expect(calls[0]!.body).toEqual({ email: "new@x.test", password: "a long password" });
    // AdVault sign-ins land on this same account.
    expect((await accountForAdvault(kv, { advaultUserId: ADV_ID, email: "new@x.test" })).id).toBe(a.id);
  });

  it("refuses an email AdVault already has (sign in instead), creating nothing", async () => {
    const kv = memoryKv();
    reply = () => json({ ok: false, error: "email_exists", userId: ADV_ID, email: "taken@x.test" }, 409);
    expect(await signUpShared(kv, api, "taken@x.test", "a long password")).toBe("exists");
    expect(await accountByEmail(kv, "taken@x.test")).toBeNull();
  });

  it("refuses an email SiteVault already has without calling AdVault", async () => {
    const kv = memoryKv();
    await legacyAccount(kv, "here@x.test", "password1");
    reply = () => json({}, 500);
    expect(await signUpShared(kv, api, "here@x.test", "a long password")).toBe("exists");
    expect(calls).toHaveLength(0);
  });

  it("falls back to a local password when AdVault is down or unconfigured", async () => {
    const kv = memoryKv();
    reply = () => json({ error: "boom" }, 502);
    const a = (await signUpShared(kv, api, "down@x.test", "a long password")) as Account;
    expect(a.advaultUserId).toBeUndefined();
    expect(await verifyPassword("a long password", a.pw)).toBe(true);
    const b = (await signUpShared(kv, { apiUrl: undefined, token: undefined }, "nocfg@x.test", "a long password")) as Account;
    expect(await verifyPassword("a long password", b.pw)).toBe(true);
  });
});

describe("moveToSharedAccount (lazy, on a proven SiteVault-password sign-in)", () => {
  it("creates the AdVault user with the typed password, keeps createdAt and first-site time, drops the local password", async () => {
    const kv = memoryKv();
    const a = await legacyAccount(kv, "old@x.test", "password1", { sites: ["bellas"] });
    reply = () => json({ ok: true, userId: ADV_ID, email: "old@x.test" }, 201);
    const moved = await moveToSharedAccount(kv, api, a, "password1", "2026-11-15T09:10:00.000Z");
    expect(calls[0]!.body).toEqual({
      email: "old@x.test",
      password: "password1",
      createdAt: "2026-11-15T09:00:00.000Z",
      sitevaultUsedAt: "2026-11-15T09:10:00.000Z",
    });
    expect(moved.advaultUserId).toBe(ADV_ID);
    expect(moved.pw).toBeNull();
    expect(moved.sites).toEqual(["bellas"]);
    expect(kv.data.get(`acctadv:${ADV_ID}`)).toBe("acct1");
    expect(JSON.parse(kv.data.get("acct:acct1")!).pw).toBeNull();
  });

  it("links an email AdVault already has without changing either password", async () => {
    const kv = memoryKv();
    const a = await legacyAccount(kv, "both@x.test", "sitevault-pw");
    reply = () => json({ ok: false, error: "email_exists", userId: ADV_ID, email: "both@x.test" }, 409);
    const linked = await moveToSharedAccount(kv, api, a, "sitevault-pw");
    expect(linked.advaultUserId).toBe(ADV_ID);
    // The SiteVault password still works here; AdVault's is untouched (it was never sent as a change).
    expect(await verifyPassword("sitevault-pw", linked.pw)).toBe(true);
    expect((await accountForAdvault(kv, { advaultUserId: ADV_ID, email: "both@x.test" })).id).toBe("acct1");
  });

  it("leaves the account alone when AdVault is unavailable (retried next sign-in)", async () => {
    const kv = memoryKv();
    const a = await legacyAccount(kv, "later@x.test", "password1");
    reply = () => {
      throw new Error("network down");
    };
    const same = await moveToSharedAccount(kv, api, a, "password1");
    expect(same).toEqual(a);
    expect(JSON.parse(kv.data.get("acct:acct1")!).advaultUserId).toBeUndefined();
  });

  it("never steals an AdVault id another SiteVault account is linked to", async () => {
    const kv = memoryKv();
    await kv.put(`acctadv:${ADV_ID}`, "someone-else");
    const a = await legacyAccount(kv, "x@x.test", "password1");
    reply = () => json({ ok: false, error: "email_exists", userId: ADV_ID, email: "x@x.test" }, 409);
    expect((await moveToSharedAccount(kv, api, a, "password1")).advaultUserId).toBeUndefined();
    expect(kv.data.get(`acctadv:${ADV_ID}`)).toBe("someone-else");
  });

  it("does nothing for an account that is already linked", async () => {
    const kv = memoryKv();
    const made = (await createAccount(kv, "sso@x.test", null, { advaultUserId: ADV_ID })) as Account;
    reply = () => json({}, 500);
    expect(await moveToSharedAccount(kv, api, made, "whatever1")).toBe(made);
    expect(calls).toHaveLength(0);
  });
});

describe("markSitevaultUsed", () => {
  it("reports usage for a linked account, skips unlinked ones, never throws", async () => {
    reply = () => json({ ok: true }, 200);
    expect(await markSitevaultUsed(api, ADV_ID, "2026-11-15T09:10:00.000Z")).toBe(true);
    expect(calls[0]!.url).toBe("https://api-internal.advault.test/internal/sitevault/usage");
    expect(calls[0]!.body).toEqual({ userId: ADV_ID, at: "2026-11-15T09:10:00.000Z" });
    expect(await markSitevaultUsed(api, null)).toBe(false);
    expect(calls).toHaveLength(1);
    reply = () => {
      throw new Error("down");
    };
    expect(await markSitevaultUsed(api, ADV_ID)).toBe(false);
  });
});
