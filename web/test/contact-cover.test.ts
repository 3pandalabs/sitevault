// The contact form (relayed by AdVault's API, a stubbed fetch) and AdVault's
// plan-cover route, through the whole Worker with an in-memory KV.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

const ORIGIN = "https://sitevault.test";
let data: Map<string, string>;
let env: Record<string, unknown>;
let sent: { url: string; body: Record<string, string> }[];
let status: number;

beforeEach(() => {
  data = new Map();
  sent = [];
  status = 204;
  const SITES = {
    get: async (k: string, t?: string) => (data.has(k) ? (t === "json" ? JSON.parse(data.get(k)!) : data.get(k)!) : null),
    put: async (k: string, v: string) => void data.set(k, v),
    delete: async (k: string) => void data.delete(k),
    list: async () => ({ keys: [], list_complete: true }),
  };
  env = { SITES, PHOTOS: {}, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: "t", ADVAULT_API_URL: "https://adv.test", BILLING: "on" };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(null, { status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const call = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(ORIGIN + path, init) as never, env as never, { waitUntil() {}, passThroughOnException() {} } as never) as Promise<Response>;

describe("contact form", () => {
  const good = { name: "Sam", email: "sam@x.test", subject: "Hi", message: "Hello <b>" };
  const post = (fields: Record<string, string>, origin = ORIGIN) =>
    call("/contact", { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "1.1.1.1" }, body: new URLSearchParams(fields) });

  it("shows the form and emails us", async () => {
    expect(await (await call("/contact")).text()).toContain('name="message"');
    const res = await post(good);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("reply to sam@x.test");
    expect(sent[0]).toMatchObject({ url: "https://adv.test/internal/sitevault/contact", body: good });
  });
  it("keeps what was typed when it can't send, escaped, and never says sent", async () => {
    status = 503;
    const res = await post(good);
    expect(res.status).toBe(503);
    const h = await res.text();
    expect(h).toContain("Hello &lt;b&gt;");
    expect(h).not.toContain("was sent");
  });
  it("refuses other origins, bad fields and bots without sending", async () => {
    expect((await post(good, "https://evil.test")).status).toBe(403);
    for (const bad of [{ name: "" }, { email: "nope" }, { subject: " " }, { message: "" }]) expect((await post({ ...good, ...bad })).status).toBe(400);
    expect((await post({ ...good, website: "x" })).status).toBe(200);
    expect(sent).toHaveLength(0);
  });
  it("limits one connection to 5 an hour", async () => {
    for (let i = 0; i < 5; i++) expect((await post(good)).status).toBe(200);
    expect((await post(good)).status).toBe(429);
    expect(sent).toHaveLength(5);
  });
});

describe("plan-cover", () => {
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const site = (over: object = {}) => ({
    slug: "lawns", name: "Lawns", status: "live", source: "advault", createdAt: "2026-01-01T00:00:00.000Z",
    billing: { status: "active", plan: "pro", buildPaid: true, paidUntil: "2026-01-01T00:00:00.000Z", renewing: false, credits: 2 },
    ...over,
  });
  const put = (over: object = {}) => data.set("site:lawns", JSON.stringify(site(over)));
  const cover = (body: unknown, token = "t", slug = "lawns") =>
    call(`/api/internal/sites/${slug}/plan-cover`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const stored = () => JSON.parse(data.get("site:lawns")!).billing;

  it("extends Pro, follows a renamed address, and is repeatable", async () => {
    put();
    data.set("alias:old", "lawns");
    expect((await cover({ until, ref: "plan:1:2026-12-24" })).status).toBe(200);
    expect(stored()).toMatchObject({ plan: "pro", paidUntil: until, planCoveredUntil: until, credits: 2 });
    expect((await cover({ until })).status).toBe(200);
    expect(stored().paidUntil).toBe(until);
    expect((await cover({ until }, "t", "old")).status).toBe(200);
  });
  it("needs the token, a sane date, an AdVault site and a paid $10", async () => {
    put();
    expect((await cover({ until }, "no")).status).toBe(401);
    expect((await cover({ until: "2099-01-01T00:00:00Z" })).status).toBe(400);
    expect((await cover(null)).status).toBe(400);
    put({ source: "web" });
    expect((await cover({ until })).status).toBe(409);
    put({ billing: { ...site().billing, status: "pending", paidUntil: null } });
    expect((await cover({ until })).status).toBe(409);
    expect(stored().status).toBe("pending");
    data.clear();
    expect((await cover({ until })).status).toBe(404);
  });
});
