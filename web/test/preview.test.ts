// "Preview my website" (2026-11-20): POST /preview renders the posted form
// with renderSite and writes NOTHING. Whole fetch handler, in-memory KV/R2/D1
// that record every write.
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index.js";

function recordingKv() {
  const data = new Map<string, string>();
  const kv = {
    data,
    writes: 0,
    async get(key: string, type?: string) {
      const v = data.get(key);
      if (v === undefined) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      data.set(key, value);
    },
    async delete(key: string) {
      kv.writes += 1;
      data.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: undefined };
    },
  };
  return kv;
}

function recordingR2() {
  const data = new Map<string, ArrayBuffer>();
  const r2 = {
    data,
    writes: 0,
    reads: [] as string[],
    async put(key: string, value: ArrayBuffer) {
      r2.writes += 1;
      data.set(key, value);
    },
    async head() {
      return null; // reservations: test/address-race.test.ts
    },
    async get(key: string) {
      r2.reads.push(key);
      const v = data.get(key);
      return v ? { body: new Uint8Array(v), size: v.byteLength, httpMetadata: {}, async json() { return JSON.parse(new TextDecoder().decode(v)); }, async text() { return new TextDecoder().decode(v); } } : null;
    },
    async delete() {
      r2.writes += 1;
    },
  };
  return r2;
}

const d1 = {
  writes: 0,
  prepare() {
    return { bind: () => ({ run: async () => void (d1.writes += 1) }) };
  },
};

let kv: ReturnType<typeof recordingKv>;
let r2: ReturnType<typeof recordingR2>;
let env: Record<string, unknown>;
let pending: Promise<unknown>[];
const ctx = () => ({ waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} }) as unknown as ExecutionContext;

const ORIGIN = "https://sitevault.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeEach(() => {
  kv = recordingKv();
  r2 = recordingR2();
  d1.writes = 0;
  pending = [];
  env = { SITES: kv, PHOTOS: r2, STATS: d1, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", INTERNAL_TOKEN: "t", BILLING: "off" };
});

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await worker.fetch(new Request(url, init) as never, env as never, ctx());
  await Promise.all(pending);
  return res;
}

function formOf(fields: Record<string, string>, extra?: (f: FormData) => void): FormData {
  const f = new FormData();
  const base = { businessName: "Green Lawns Co", category: "landscaping", phone: "(555) 201-0000", city: "Edison, NJ", services: "Lawn mowing - from $35\nSpring cleanup - $149", hours: "Mon-Fri 8am-6pm", template: "split", slug: "green-lawns-co" };
  for (const [k, v] of Object.entries({ ...base, ...fields })) f.set(k, v);
  extra?.(f);
  return f;
}
const preview = (body: FormData, url = `${ORIGIN}/preview`, headers: Record<string, string> = { origin: ORIGIN }) => call(url, { method: "POST", body, headers });

describe("POST /preview", () => {
  it("renders the posted business with the live renderer, not-published bar and noindex", async () => {
    const res = await preview(formOf({}));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Green Lawns Co");
    expect(html).toContain("Lawn mowing");
    expect(html).toContain("Spring cleanup");
    expect(html).toMatch(/8\s?am/i);
    expect(html).toMatch(/<body[^>]*><div role="status"[^>]*><span>Preview — not published yet\./);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The chosen style is used.
    expect(html).toMatch(/class="hero split/);
  });

  it("writes nothing: no KV, R2 or D1, no account, no site, no address", async () => {
    const res = await preview(formOf({ acct_email: "new@example.com", acct_password: "longenough1" }, (f) => f.append("photos", new File([PNG], "a.png", { type: "image/png" }))));
    expect(res.status).toBe(200);
    expect(kv.writes).toBe(0);
    expect(kv.data.size).toBe(0);
    expect(r2.writes).toBe(0);
    expect(d1.writes).toBe(0);
  });

  it("shows a freshly uploaded photo inline from the request", async () => {
    const html = await (await preview(formOf({}, (f) => f.append("photos", new File([PNG], "a.png", { type: "image/png" }))))).text();
    expect(html).toContain("data:image/png;base64,");
  });

  it("rejects invalid input with a page listing what to fix", async () => {
    const res = await preview(formOf({ businessName: "", phone: "" }));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Fix these to see your preview");
    expect(html).toMatch(/<li>[^<]+<\/li>/);
    expect(kv.writes + r2.writes).toBe(0);
    // Links in free text are refused, as on create.
    expect((await preview(formOf({ about: "Visit https://evil.test now" }))).status).toBe(400);
  });

  it("refuses a cross-site post", async () => {
    expect((await preview(formOf({}), `${ORIGIN}/preview`, { origin: "https://evil.test" })).status).toBe(403);
    expect((await preview(formOf({}), `${ORIGIN}/preview`, {})).status).toBe(403);
  });

  it("never loads a foreign photo key (keep / keepDraft / draft from the form)", async () => {
    const foreign = "sites/someone-else/abcdef123456.jpg";
    r2.data.set(foreign, new Uint8Array([1, 2, 3]).buffer);
    const html = await (
      await preview(
        formOf({ draft: "d".repeat(20), key: "nope" }, (f) => {
          f.append("keep", foreign);
          f.append("keepDraft", foreign);
        }),
      )
    ).text();
    expect(html).not.toContain("someone-else");
    expect(r2.reads.filter((k) => k === foreign)).toEqual([]);
    // Edit-page preview of a site the caller can't edit: kept keys ignored too.
    const edit = await (await preview(formOf({ key: "wrong" }, (f) => f.append("keep", foreign)), `${ORIGIN}/preview?site=someone-else`)).text();
    expect(edit).not.toContain("someone-else/abcdef");
  });
});
