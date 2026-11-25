// The panda helper: right answers (typos included), honest misses, prices from
// billing.ts, and where its script may and may not appear.
import { beforeEach, describe, expect, it } from "vitest";
import { Script } from "node:vm";
import worker from "../src/index.js";
import { STARTERS, helpTopics, matchTopics } from "../src/help.js";
import { helperScript } from "../src/helper-client.js";

const ON = { on: true, earlyAccessUntil: null, festiveUntil: "2027-01-31" };
const FESTIVE = new Date("2026-11-24T12:00:00Z");
const LATER = new Date("2027-03-01T12:00:00Z");
const topics = helpTopics(ON, FESTIVE);
const pick = (q: string) => matchTopics(q, topics)[0]?.id ?? null;

describe("matching", () => {
  it.each([
    ["how price is calcualted", "price"],
    ["how much does it cost", "price"],
    ["is it free", "price"],
    ["what is the diffrence between basic and pro", "plans"],
    ["how do I get started", "start"],
    ["can I chnage my website", "edit"],
    ["change the photos on my site", "edit"],
    ["can I use my own domain", "address"],
    ["how many photos can I upload", "photos"],
    ["what are offer credits", "offer"],
    ["where are my visitor stats", "stats"],
    ["can customers leave a review", "reviews"],
    ["how do I cancel", "cancel"],
    ["what happens if I stop paying", "lapse"],
    ["do I pay twice with advault", "advault"],
    ["can I get a youtube ad", "ads"],
    ["can I have two websites", "many"],
    ["forgot my pasword", "login"],
    ["take down my website", "remove"],
    ["delete my account", "delete"],
    ["do you use cookies", "privacy"],
    ["what is the weather in paris", null],
    ["can I speak to a person", null],
    ["asdf qwer", null],
    ["", null],
  ])("%s -> %s", (q, want) => expect(pick(q)).toBe(want));

  it("every topic is found by its own question, and starters exist", () => {
    for (const t of topics) expect([t.q, pick(t.q)]).toEqual([t.q, t.id]);
    for (const id of STARTERS) expect(topics.some((t) => t.id === id)).toBe(true);
  });

  it("quotes the festive price only while the offer is open", () => {
    const price = (now: Date, cfg = ON) => helpTopics(cfg, now).find((t) => t.id === "price")!.a;
    expect(price(FESTIVE)).toContain("Basic $29 a year or Pro $59 a year, locked for life if you pay by January 31, 2027");
    expect(price(LATER)).not.toContain("29");
    expect(price(LATER)).toContain("Basic is $49 a year and Pro is $89 a year");
    expect(price(LATER, { ...ON, on: false })).toContain("free during early access");
  });
});

describe("pages", () => {
  const ORIGIN = "https://sitevault.test";
  let env: Record<string, unknown>;
  beforeEach(() => {
    const SITES = { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) };
    env = { SITES, PHOTOS: { get: async () => null, head: async () => null }, PUBLIC_ORIGIN: ORIGIN, SITES_DOMAIN: "3pandasite.test", BILLING: "on", FESTIVE_UNTIL: "2027-01-31" };
  });
  const call = (url: string, init: RequestInit = {}) =>
    worker.fetch(new Request(url, init) as never, env as never, { waitUntil() {}, passThroughOnException() {} } as never) as Promise<Response>;

  it("/faq lists the questions, is linked from the footer, and the helper script carries the page's nonce", async () => {
    for (const p of ["/faq", "/", "/contact", "/terms"]) {
      const res = await call(ORIGIN + p);
      const h = await res.text();
      const n = res.headers.get("content-security-policy")!.match(/script-src 'nonce-([^']+)'/)![1];
      expect(h).toContain(`<script nonce="${n}" src="/helper.js" defer></script>`);
      expect(h).toContain('href="/faq"');
      expect(h).not.toContain("<!--helper-->");
    }
    expect(await (await call(`${ORIGIN}/faq`)).text()).toContain("How much does a website cost?");
  });

  it("counts visits only from pages with the helper, sending no path past the first segment", async () => {
    expect((await call(ORIGIN + "/")).headers.get("content-security-policy")).toContain("connect-src 'self' https://counts.3pandalabs.com");
    expect((await call("https://nobody.3pandasite.test/")).headers.get("content-security-policy") ?? "").not.toContain("counts.");
    const sent: string[] = [];
    const js = helperScript([]).split("\n(function(){\nvar KEY")[0]!;
    const run = (location: object, stored: Record<string, string> = {}) =>
      new Script(js.slice(0, js.indexOf("(function(){\nvar KEY") >= 0 ? js.indexOf("(function(){\nvar KEY") : undefined)).runInNewContext({
        location, URL, URLSearchParams, document: { referrer: "https://www.linkedin.com/feed/abc" },
        performance: { getEntriesByType: () => [{ type: "navigate" }] },
        localStorage: { getItem: (k: string) => stored[k] ?? null, setItem: (k: string, v: string) => void (stored[k] = v), removeItem: (k: string) => void delete stored[k] },
        navigator: { sendBeacon: (_u: string, b: string) => void sent.push(b) },
      });
    const host = "sitevault.3pandalabs.com";
    run({ hostname: host, pathname: "/edit/lawns", search: "?key=SECRET" });
    expect(JSON.parse(sent[0]!)).toEqual({ v: 1, h: "www.linkedin.com", s: "", m: "", g: 0, p: "/edit" });
    run({ hostname: host, pathname: "/", search: "?nocount=1" });
    run({ hostname: "lawns.3pandasite.com", pathname: "/", search: "" });
    expect(sent).toHaveLength(1);
  });

  it("never loads on a customer host", async () => {
    expect(await (await call("https://nobody.3pandasite.test/")).text()).not.toContain("helper.js");
  });

  it("serves a script that parses, and the panda", async () => {
    const js = await (await call(`${ORIGIN}/helper.js`)).text();
    expect(() => new Script(js)).not.toThrow();
    expect(() => new Script(helperScript([{ id: "x", q: "</script>'\"" }]))).not.toThrow();
    expect((await call(`${ORIGIN}/panda-helper.webp`)).headers.get("content-type")).toBe("image/webp");
  });

  it("answers by question or id, says when it can't, and refuses junk", async () => {
    const post = (body: string) => call(`${ORIGIN}/api/help`, { method: "POST", body });
    expect(await (await post(JSON.stringify({ q: "how do I cancel" }))).json()).toMatchObject({ topic: { id: "cancel" } });
    expect(await (await post(JSON.stringify({ id: "plans" }))).json()).toMatchObject({ topic: { id: "plans" }, more: [] });
    expect(await (await post(JSON.stringify({ q: "fax machines" }))).json()).toEqual({ topic: null, more: [] });
    expect((await post("nope")).status).toBe(400);
    expect(await (await post("null")).json()).toEqual({ topic: null, more: [] });
  });
});
