// Stripe return race (2026-11-25): when the buyer lands back on the edit page,
// the session is verified and the site is published at once, instead of waiting
// for the webhook. Covers the happy path, the no-op when already live, and that
// a credits pack is left to the webhook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { initialBilling, type Billing, type BillingConfig } from "../src/billing.js";
import { parseContent, type Site } from "../src/site.js";
import { sha256Hex } from "../src/util.js";

const ORIGIN = "https://sitevault.test";
const ON: BillingConfig = { on: true, earlyAccessUntil: "2027-01-31" };
const KEY = "edit-key-abcdefghij";

function memoryKv() {
  const data = new Map<string, { value: string }>();
  return {
    data,
    async get(key: string, type?: string) {
      const e = data.get(key);
      if (!e) return null;
      return type === "json" ? JSON.parse(e.value) : e.value;
    },
    async put(key: string, value: string) {
      data.set(key, { value });
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

let kv: ReturnType<typeof memoryKv>;
let env: Record<string, unknown>;
let fetchCalls: string[];
const ctx = () => ({ waitUntil() {}, passThroughOnException() {} }) as unknown as ExecutionContext;

async function seed(slug: string, billing: Billing | undefined) {
  const parsed = parseContent({ businessName: "Wax and Wheels", category: "carwash", phone: "(555) 123-0000", city: "Edison, NJ" });
  if (!parsed.ok) throw new Error("fixture invalid");
  const site: Site = {
    ...parsed.value,
    slug,
    photos: [],
    status: "live",
    source: "web",
    editKeyHash: await sha256Hex(KEY),
    createdAt: "2026-11-20T00:00:00Z",
    updatedAt: "2026-11-20T00:00:00Z",
    ...(billing ? { billing } : {}),
  };
  await kv.put(`site:${slug}`, JSON.stringify(site));
}

const stripeSession = (slug: string, kind: string) => ({
  id: "cs_test_1",
  payment_status: "paid",
  metadata: { app: "sitevault", slug, kind },
  customer: "cus_1",
  subscription: kind === "credits" ? null : "sub_1",
  customer_details: { email: "owner@wash.test" },
});

beforeEach(() => {
  kv = memoryKv();
  fetchCalls = [];
  env = { SITES: kv, PHOTOS: {}, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", BILLING: "on", STRIPE_SECRET_KEY: "sk_test_x" };
});
afterEach(() => vi.unstubAllGlobals());

function stubStripe(session: unknown) {
  vi.stubGlobal("fetch", async (url: string) => {
    fetchCalls.push(url);
    return new Response(JSON.stringify(session), { status: 200, headers: { "content-type": "application/json" } });
  });
}

async function openEdit(slug: string, qs: string) {
  const res = await worker.fetch(new Request(`${ORIGIN}/edit/${slug}?k=${KEY}${qs}`) as never, env as never, ctx());
  return res;
}
const stored = (slug: string) => JSON.parse(kv.data.get(`site:${slug}`)!.value) as Site;

describe("finalize checkout on return", () => {
  it("publishes a pending site at once when the buyer returns with a paid session", async () => {
    await seed("wax", initialBilling("web", ON, new Date()));
    expect(stored("wax").billing!.status).toBe("pending");
    stubStripe(stripeSession("wax", "publish_basic"));

    const res = await openEdit("wax", "&paid=1&session_id=cs_test_1");
    expect(res.status).toBe(200);
    expect(fetchCalls.some((u) => u.includes("/checkout/sessions/cs_test_1"))).toBe(true);

    const b = stored("wax").billing!;
    expect(b.status).toBe("active");
    expect(b.plan).toBe("basic");
    expect(b.paidUntil && new Date(b.paidUntil).getTime() > Date.now()).toBe(true);
  });

  it("does not call Stripe when the site is already live", async () => {
    await seed("wax", { status: "active", plan: "basic", buildPaid: true, paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(), renewing: true, credits: 2 });
    stubStripe(stripeSession("wax", "publish_basic"));

    const res = await openEdit("wax", "&session_id=cs_test_1");
    expect(res.status).toBe(200);
    expect(fetchCalls.length).toBe(0);
  });

  it("leaves a credits pack to the webhook (not published, no credits added on return)", async () => {
    await seed("wax", initialBilling("web", ON, new Date()));
    stubStripe(stripeSession("wax", "credits"));

    await openEdit("wax", "&session_id=cs_test_1");
    const b = stored("wax").billing!;
    expect(b.status).toBe("pending"); // still unpublished
    expect(b.credits).toBe(initialBilling("web", ON, new Date())!.credits); // unchanged
  });
});
