// Quotes, call-backs, bookings and review requests through the whole Worker:
// in-memory KV/R2, and AdVault's /internal/sitevault/leads* routes as a
// stubbed fetch that records what SiteVault sends (the contract).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { accountForAdvault, startSession } from "../src/accounts.js";

function memoryKv() {
  const data = new Map<string, { value: string; metadata?: unknown }>();
  return {
    data,
    async get(key: string, type?: string) {
      const e = data.get(key);
      if (!e) return null;
      return type === "json" ? JSON.parse(e.value) : e.value;
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      data.set(key, { value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: undefined };
    },
  };
}

function memoryR2() {
  const data = new Map<string, { bytes: ArrayBuffer; type?: string }>();
  return {
    data,
    async put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }) {
      if (key.startsWith("addr/")) return {};
      data.set(key, { bytes: typeof value === "string" ? new TextEncoder().encode(value).buffer : value, type: opts?.httpMetadata?.contentType });
      return {};
    },
    async head() {
      return null;
    },
    async get(key: string) {
      const v = data.get(key);
      return v ? { body: new Uint8Array(v.bytes), size: v.bytes.byteLength, httpMetadata: { contentType: v.type } } : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { objects: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
}

const ORIGIN = "https://sitevault.test";
const ADV = "https://adv.test";
const TOKEN = "internal-token";
const ADV_ID = "11111111-2222-3333-4444-555555555555";
const auth = { authorization: `Bearer ${TOKEN}` };

let kv: ReturnType<typeof memoryKv>;
let r2: ReturnType<typeof memoryR2>;
let env: Record<string, unknown>;
type Sent = { method: string; path: string; body: Record<string, unknown> | null; auth: string | null };
let sent: Sent[];
/** What the fake AdVault answers, by "METHOD /path" (without the query). */
let answers: Record<string, { status: number; body?: unknown }>;
let advaultDown: boolean;

beforeEach(() => {
  kv = memoryKv();
  r2 = memoryR2();
  sent = [];
  answers = {};
  advaultDown = false;
  env = { SITES: kv, PHOTOS: r2, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: TOKEN, ADVAULT_API_URL: ADV, BILLING: "off" };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const method = init.method ?? "GET";
    sent.push({ method, path: u.pathname + u.search, body, auth: new Headers(init.headers).get("authorization") });
    if (advaultDown) throw new Error("connection refused");
    let key = `${method} ${u.pathname}`;
    if (/^\/internal\/sitevault\/leads\/[^/]+\/(status|review-request)$/.test(u.pathname)) key = `${method} ${u.pathname.replace(/leads\/[^/]+\//, "leads/:id/")}`;
    const a = answers[key] ?? (key === "POST /internal/sitevault/leads" ? { status: 201, body: { leadId: "lead-1" } } : key === "GET /internal/sitevault/leads/busy" ? { status: 200, body: { busy: [] } } : { status: 404, body: {} });
    return new Response(a.status === 204 ? null : JSON.stringify(a.body ?? {}), { status: a.status, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const call = (url: string, init: RequestInit = {}) => worker.fetch(new Request(url, init) as never, env as never, ctx) as Promise<Response>;
const leadCalls = () => sent.filter((s) => s.method === "POST" && s.path === "/internal/sitevault/leads");

async function makeSite(fields: Record<string, string> = {}): Promise<{ slug: string; key: string; host: string }> {
  const form = new FormData();
  for (const [k, v] of Object.entries({ businessName: "Green Lawns", category: "landscaping", phone: "(555) 201-0000", city: "Austin, TX", slug: "green-lawns", ...fields })) form.set(k, v);
  const res = await call(`${ORIGIN}/api/internal/sites`, { method: "POST", headers: auth, body: form });
  expect(res.status).toBe(201);
  const { slug, editUrl } = (await res.json()) as { slug: string; editUrl: string };
  return { slug, key: new URL(editUrl).searchParams.get("k")!, host: `https://${slug}.3pandasite.test` };
}

function formOf(fields: Record<string, string>, files: Record<string, File[]> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  for (const [k, list] of Object.entries(files)) for (const file of list) f.append(k, file);
  return f;
}

const jpeg = (name = "a.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], name, { type: "image/jpeg" });

describe("quote and call-back forms on the customer site", () => {
  it("are on every published site, with the visitor's source read on the server", async () => {
    const { host } = await makeSite();
    const res = await call(`${host}/?utm_source=youtube&utm_campaign=spring`, { headers: { referer: "https://www.youtube.com/watch?v=1" } });
    const page = await res.text();
    expect(page).toContain('id="quote"');
    expect(page).toContain("Request a quote");
    expect(page).toContain("Call me back");
    expect(page).toContain('action="/lead"');
    expect(page).toContain('name="src_ref" value="www.youtube.com"');
    expect(page).toContain('name="src_us" value="youtube"');
    expect(page).toContain('name="src_uc" value="spring"');
    // No third-party script, no cookie, the strict CSP is unchanged.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page).not.toMatch(/<script[^>]+src=/);
    // No booking section until the owner turns it on.
    expect(page).not.toContain('action="/book"');
  });

  it("sends a quote to AdVault (contract body, owner ids, photo links) and thanks the visitor", async () => {
    const { host, slug } = await makeSite({ ownerAdvaultUserId: ADV_ID, ownerEmail: "owner@lawns.test" });
    const res = await call(`${host}/lead`, {
      method: "POST",
      body: formOf({ kind: "quote", idem: "abcdefgh1234", name: "Ann", phone: "(555) 333-4444", email: "Ann@Example.com", message: "Mow my lawn", src_us: "youtube", src_ref: "www.youtube.com" }, { photos: [jpeg()] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Green Lawns has your request");
    const [lead] = leadCalls();
    expect(lead!.auth).toBe(`Bearer ${TOKEN}`);
    const body = lead!.body!;
    expect(body).toMatchObject({
      slug,
      kind: "quote",
      name: "Ann",
      phone: "(555) 333-4444",
      email: "ann@example.com",
      message: "Mow my lawn",
      source: { referrerHost: "www.youtube.com", utmSource: "youtube" },
      idempotencyKey: `${slug}:abcdefgh1234`,
      ownerEmail: "owner@lawns.test",
      advaultUserId: ADV_ID,
    });
    const urls = body.photoUrls as string[];
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(new RegExp(`^${ORIGIN}/lead-photo/${slug}/[A-Za-z0-9_-]{16,}\\.jpg$`));
    // The owner's private photo link works on the main host, never indexed or publicly cached.
    const photo = await call(urls[0]!);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("cache-control")).toContain("private");
    expect(photo.headers.get("x-robots-tag")).toBe("noindex");
    // And it is NOT one of the site's public files.
    const key = [...r2.data.keys()].find((k) => k.startsWith("leads/"))!;
    expect((await call(`${host}/p/${key}`)).status).toBe(404);
    expect((await call(`${ORIGIN}/p/${key}`)).status).toBe(404);
  });

  it("sends a call-back with the best time", async () => {
    const { host } = await makeSite();
    const res = await call(`${host}/lead`, { method: "POST", body: formOf({ kind: "callback", name: "Bo", phone: "555 222 1111", bestTime: "After 5 pm" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("will call you back");
    expect(leadCalls()[0]!.body).toMatchObject({ kind: "callback", name: "Bo", bestTime: "After 5 pm" });
    expect(leadCalls()[0]!.body!.idempotencyKey).toMatch(/^green-lawns:/);
  });

  it("never loses the form: AdVault down = 'please call', values kept, photos removed", async () => {
    const { host } = await makeSite();
    advaultDown = true;
    const res = await call(`${host}/lead`, { method: "POST", body: formOf({ kind: "quote", name: "Ann", phone: "5553334444", message: "Fence <repair>" }, { photos: [jpeg()] }) });
    expect(res.status).toBe(503);
    const page = await res.text();
    expect(page).toContain("couldn&#39;t send your request. Please call (555) 201-0000");
    expect(page).toContain('value="Ann"');
    expect(page).toContain("Fence &lt;repair&gt;");
    expect([...r2.data.keys()].filter((k) => k.startsWith("leads/"))).toEqual([]);
  });

  it("checks the fields, drops honeypot posts and limits each connection", async () => {
    const { host } = await makeSite();
    const bad = await call(`${host}/lead`, { method: "POST", body: formOf({ kind: "quote", name: "", phone: "1" }) });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Please add a phone number");
    const tooMany = await call(`${host}/lead`, { method: "POST", body: formOf({ kind: "quote", name: "A", phone: "5553334444" }, { photos: [jpeg(), jpeg(), jpeg(), jpeg()] }) });
    expect(tooMany.status).toBe(400);
    const bot = await call(`${host}/lead`, { method: "POST", body: formOf({ kind: "quote", name: "A", phone: "5553334444", website: "spam.test" }) });
    expect(bot.status).toBe(200);
    expect(leadCalls()).toHaveLength(0);
    for (let i = 0; i < 6; i++) {
      const ok = await call(`${host}/lead`, { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, body: formOf({ kind: "callback", name: "A", phone: "5553334444" }) });
      expect(ok.status).toBe(200);
    }
    const limited = await call(`${host}/lead`, { method: "POST", headers: { "cf-connecting-ip": "1.2.3.4" }, body: formOf({ kind: "callback", name: "A", phone: "5553334444" }) });
    expect(limited.status).toBe(429);
    expect(leadCalls()).toHaveLength(6);
  });
});

/** Turn bookings on from the editor's form (edit key), every day 00:00-23:30, no lead time. */
async function enableBookings(slug: string, key: string, extra: Record<string, string> = {}): Promise<Response> {
  const fields: Record<string, string> = { key, bookingOn: "yes", svcName0: "Lawn mowing", svcMin0: "60", svcPrice0: "$35", timezone: "America/Chicago", leadHours: "0", daysAhead: "7", ...extra };
  for (let d = 0; d < 7; d++) Object.assign(fields, { [`day${d}`]: "yes", [`day${d}s0`]: "00:00", [`day${d}e0`]: "23:30" });
  return call(`${ORIGIN}/api/sites/${slug}/bookings`, { method: "POST", body: formOf(fields) });
}

describe("online booking", () => {
  it("is set up on the edit page and shown on the site", async () => {
    const { slug, key, host } = await makeSite();
    const edit = await (await call(`${ORIGIN}/edit/${slug}?k=${encodeURIComponent(key)}`)).text();
    expect(edit).toContain('id="bookings"');
    expect(edit).toContain(`action="/api/sites/${slug}/bookings"`);
    // Defaults from the site's location (Austin, TX).
    expect(edit).toContain('<option value="America/Chicago" selected>');
    const saved = await enableBookings(slug, key);
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(`${ORIGIN}/edit/${slug}?k=${encodeURIComponent(key)}&bk=1#bookings`);
    const site = JSON.parse(kv.data.get(`site:${slug}`)!.value);
    expect(site.booking).toMatchObject({ on: true, timezone: "America/Chicago", services: [{ name: "Lawn mowing", durationMin: 60, price: "$35" }] });
    const page = await (await call(`${host}/`)).text();
    expect(page).toContain('action="/book"');
    expect(page).toContain("Lawn mowing");
  });

  it("shows field errors without saving, and refuses someone else", async () => {
    const { slug, key } = await makeSite();
    const res = await call(`${ORIGIN}/api/sites/${slug}/bookings`, { method: "POST", body: formOf({ key, bookingOn: "yes" }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Add at least one service");
    expect(JSON.parse(kv.data.get(`site:${slug}`)!.value).booking).toBeUndefined();
    const stranger = await call(`${ORIGIN}/api/sites/${slug}/bookings`, { method: "POST", body: formOf({ key: "wrong", bookingOn: "yes" }) });
    expect(stranger.status).toBe(303);
    expect(stranger.headers.get("location")).toBe(`${ORIGIN}/login`);
  });

  it("walks service -> day -> time and sends a booking request with the zone's offset", async () => {
    const { slug, key, host } = await makeSite({ ownerAdvaultUserId: ADV_ID, ownerEmail: "owner@lawns.test" });
    await enableBookings(slug, key);
    const step1 = await (await call(`${host}/book`)).text();
    expect(step1).toContain("Step 1 of 3");
    const step2 = await (await call(`${host}/book?service=0&src_us=youtube`)).text();
    expect(step2).toContain("Step 2 of 3");
    const day = step2.match(/date=(\d{4}-\d{2}-\d{2})/)![1]!;
    expect(step2).toContain("src_us=youtube");
    const busyCall = sent.find((s) => s.path.startsWith("/internal/sitevault/leads/busy?"))!;
    expect(new URL(ADV + busyCall.path).searchParams.get("slug")).toBe(slug);
    const step3 = await (await call(`${host}/book?service=0&date=${day}&src_us=youtube`)).text();
    const start = step3.match(/name="start" value="([^"]+)"/)![1]!;
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-0[56]:00$/);
    const idem = step3.match(/name="idem" value="([^"]+)"/)![1]!;
    const res = await call(`${host}/book`, { method: "POST", body: formOf({ service: "0", date: day, start, idem, src_us: "youtube", name: "Cy", phone: "5554445555", email: "cy@example.com" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Request sent — Green Lawns will confirm by email.");
    expect(leadCalls()[0]!.body).toMatchObject({
      slug,
      kind: "booking",
      name: "Cy",
      email: "cy@example.com",
      booking: { service: "Lawn mowing", durationMin: 60, start, timezone: "America/Chicago" },
      source: { utmSource: "youtube" },
      idempotencyKey: `${slug}:${idem}`,
      advaultUserId: ADV_ID,
      ownerEmail: "owner@lawns.test",
    });
  });

  it("hides busy times, refuses a time that isn't free, and handles slot_taken", async () => {
    const { slug, key, host } = await makeSite();
    await enableBookings(slug, key);
    const step2 = await (await call(`${host}/book?service=0`)).text();
    const day = [...step2.matchAll(/date=(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]!).at(-1)!;
    const all = [...(await (await call(`${host}/book?service=0&date=${day}`)).text()).matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1]!);
    const taken = all[4]!;
    answers["GET /internal/sitevault/leads/busy"] = { status: 200, body: { busy: [{ start: taken, end: new Date(Date.parse(taken) + 3_600_000).toISOString() }] } };
    const now = [...(await (await call(`${host}/book?service=0&date=${day}`)).text()).matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1]!);
    expect(now).not.toContain(taken);
    const base = { service: "0", date: day, name: "Cy", phone: "5554445555", email: "cy@example.com" };
    const refused = await call(`${host}/book`, { method: "POST", body: formOf({ ...base, start: taken }) });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("Please pick one of the free times");
    expect(leadCalls()).toHaveLength(0);
    answers["POST /internal/sitevault/leads"] = { status: 409, body: { error: "slot_taken" } };
    const raced = await call(`${host}/book`, { method: "POST", body: formOf({ ...base, start: now[0]! }) });
    expect(raced.status).toBe(409);
    expect(await raced.text()).toContain("that time was just taken");
    const noEmail = await call(`${host}/book`, { method: "POST", body: formOf({ ...base, email: "", start: now[0]! }) });
    expect(noEmail.status).toBe(400);
    expect(await noEmail.text()).toContain("so we can confirm your booking");
  });

  it("sends people back to the site while bookings are off", async () => {
    const { host } = await makeSite();
    const res = await call(`${host}/book?service=0`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${host}/`);
  });
});

describe("review requests", () => {
  const PLACE = "ChIJN1t_tDeuEmsRUsoyG83frY4";

  it("builds the review link from AdVault's Place ID, and exposes it to AdVault", async () => {
    const { slug, host } = await makeSite({ placeId: PLACE });
    expect(JSON.parse(kv.data.get(`site:${slug}`)!.value).placeId).toBe(PLACE);
    const ask = await call(`${host}/review`);
    expect(ask.status).toBe(200);
    expect(await ask.text()).toContain(`https://search.google.com/local/writereview?placeid=${PLACE}`);
    const internal = await call(`${ORIGIN}/api/internal/sites/${slug}/review-link`, { headers: auth });
    expect(await internal.json()).toEqual({ url: `https://search.google.com/local/writereview?placeid=${PLACE}` });
    expect((await call(`${ORIGIN}/api/internal/sites/${slug}/review-link`)).status).toBe(401);
    expect((await call(`${ORIGIN}/api/internal/sites/nobody-here/review-link`, { headers: auth })).status).toBe(404);
  });

  it("has no review page until a link is set; the owner's link and rating then show", async () => {
    const { slug, key, host } = await makeSite();
    expect((await call(`${host}/review`)).status).toBe(302);
    expect(await (await call(`${ORIGIN}/api/internal/sites/${slug}/review-link`, { headers: auth })).json()).toEqual({ url: null });
    await call(`${ORIGIN}/api/sites/${slug}/bookings`, { method: "POST", body: formOf({ key, reviewLink: "https://g.page/r/abc123/review", googleRating: "4.8", googleCount: "120" }) });
    const page = await (await call(`${host}/`)).text();
    expect(page).toContain("4.8</strong> on Google · 120 reviews");
    expect(page).toContain('href="/review"');
    expect(await (await call(`${host}/review`)).text()).toContain('href="https://g.page/r/abc123/review"');
    // Not a redirect host: only Google's own links are accepted.
    const evil = await call(`${ORIGIN}/api/sites/${slug}/bookings`, { method: "POST", body: formOf({ key, reviewLink: "https://evil.test/login" }) });
    expect(evil.status).toBe(400);
  });

  it("prints a card with a server-made QR code, for the owner only", async () => {
    const { slug, key } = await makeSite({ placeId: PLACE });
    const card = await call(`${ORIGIN}/edit/${slug}/review-card?k=${encodeURIComponent(key)}`);
    expect(card.status).toBe(200);
    const text = await card.text();
    expect(text).toContain("Enjoyed your visit? Leave us a review");
    expect(text).toContain("<svg");
    expect(text).toContain(`${slug}.3pandasite.test/review`);
    expect(text).not.toMatch(/<script[^>]+src=/);
    expect((await call(`${ORIGIN}/edit/${slug}/review-card?k=nope`)).status).toBe(403);
  });
});

describe("owner's requests on My website", () => {
  async function signedInOwner() {
    const { slug, key } = await makeSite({ ownerAdvaultUserId: ADV_ID, ownerEmail: "owner@lawns.test", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
    const account = await accountForAdvault(kv as unknown as KVNamespace, { advaultUserId: ADV_ID, email: "owner@lawns.test" });
    const cookie = `sv_session=${await startSession(kv as unknown as KVNamespace, account.id)}`;
    return { slug, key, cookie };
  }

  it("lists the site's leads from AdVault with the right actions", async () => {
    const { slug, cookie } = await signedInOwner();
    answers["GET /internal/sitevault/leads"] = {
      status: 200,
      body: {
        leads: [
          { id: "b1", kind: "booking", status: "requested", name: "Cy", phone: "5554445555", email: "cy@example.com", message: null, bestTime: null, photoUrls: [], booking: { service: "Lawn mowing", durationMin: 60, start: "2026-12-01T09:00:00-06:00", timezone: "America/Chicago" }, source: { utmSource: "youtube" }, createdAt: "2026-11-27T10:00:00Z" },
          { id: "q1", kind: "quote", status: "new", name: "Ann <b>", phone: "5553334444", email: null, message: "Fence", bestTime: null, photoUrls: ["https://sitevault.test/lead-photo/x/abc.jpg", "javascript:alert(1)"], booking: null, source: null, createdAt: "2026-11-27T09:00:00Z" },
        ],
      },
    };
    const page = await (await call(`${ORIGIN}/account`, { headers: { cookie } })).text();
    const list = sent.find((s) => s.path.startsWith("/internal/sitevault/leads?"))!;
    const q = new URL(ADV + list.path).searchParams;
    expect([q.get("slug"), q.get("advaultUserId"), q.get("email")]).toEqual([slug, ADV_ID, "owner@lawns.test"]);
    expect(page).toContain("Requests from your website");
    expect(page).toContain("Lawn mowing, Tue, Dec 1, 9:00 am");
    expect(page).toContain('value="confirmed"');
    expect(page).toContain('value="declined"');
    expect(page).toContain("Ann &lt;b&gt;");
    expect(page).not.toContain("javascript:alert");
    expect(page).toContain("Ask for a review");
  });

  it("says so when AdVault can't be reached", async () => {
    const { cookie } = await signedInOwner();
    advaultDown = true;
    const page = await (await call(`${ORIGIN}/account`, { headers: { cookie } })).text();
    expect(page).toContain("couldn't load your requests");
  });

  it("forwards confirm/decline and review requests (session + same origin)", async () => {
    const { slug, cookie } = await signedInOwner();
    answers["POST /internal/sitevault/leads/:id/status"] = { status: 204 };
    answers["POST /internal/sitevault/leads/:id/review-request"] = { status: 204 };
    const headers = { cookie, origin: ORIGIN };
    const ok = await call(`${ORIGIN}/account/leads/b1/status`, { method: "POST", headers, body: formOf({ slug, status: "confirmed" }) });
    expect(ok.headers.get("location")).toBe(`${ORIGIN}/account?lead=ok#leads`);
    expect(sent.at(-1)).toMatchObject({ path: "/internal/sitevault/leads/b1/status", body: { status: "confirmed", advaultUserId: ADV_ID, email: "owner@lawns.test" } });
    const asked = await call(`${ORIGIN}/account/leads/b1/review-request`, { method: "POST", headers, body: formOf({ slug }) });
    expect(asked.headers.get("location")).toBe(`${ORIGIN}/account?lead=asked#leads`);
    expect(sent.at(-1)!.body).toMatchObject({ reviewUrl: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4" });
    answers["POST /internal/sitevault/leads/:id/review-request"] = { status: 409, body: { error: "already_requested" } };
    const again = await call(`${ORIGIN}/account/leads/b1/review-request`, { method: "POST", headers, body: formOf({ slug }) });
    expect(again.headers.get("location")).toBe(`${ORIGIN}/account?lead=already#leads`);
    const n = sent.length;
    const bad = await call(`${ORIGIN}/account/leads/b1/status`, { method: "POST", headers, body: formOf({ slug, status: "deleted" }) });
    expect(bad.headers.get("location")).toBe(`${ORIGIN}/account?lead=failed#leads`);
    const crossSite = await call(`${ORIGIN}/account/leads/b1/status`, { method: "POST", headers: { cookie, origin: "https://evil.test" }, body: formOf({ slug, status: "done" }) });
    expect(crossSite.headers.get("location")).toBe(`${ORIGIN}/login`);
    const notMine = await call(`${ORIGIN}/account/leads/b1/status`, { method: "POST", headers, body: formOf({ slug: "someone-else", status: "done" }) });
    expect(notMine.headers.get("location")).toBe(`${ORIGIN}/account?lead=failed#leads`);
    expect(sent.length).toBe(n);
  });
});
