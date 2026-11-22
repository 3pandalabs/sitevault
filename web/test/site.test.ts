import { describe, expect, it } from "vitest";
import {
  BEFORE_AFTER_CATEGORIES,
  CATEGORIES,
  INTERNAL_BEFORE_AFTER_TYPES,
  beforeAfterAllowed,
  headline,
  locationsToText,
  parseContent,
  parseLocations,
  parseReviewSubmission,
  parseServices,
  pickBeforeAfter,
  reviewStats,
  servicesToText,
  siteFileKeys,
  type Review,
} from "../src/site.js";
import { renderHold, renderSite } from "../src/render.js";
import { esc, jsonForScript, phoneIdentity, slugify, telHref } from "../src/util.js";
import type { Site } from "../src/site.js";

const base = {
  businessName: "EkMoliya Landscaping",
  category: "landscaping",
  phone: "(201) 555-0100",
  city: "Secaucus, NJ",
};

describe("parseContent", () => {
  it("accepts the three required fields", () => {
    const r = parseContent(base);
    expect(r.ok).toBe(true);
  });

  it("requires name, phone, city and a known category", () => {
    const r = parseContent({ category: "spaceship" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["businessName", "category", "city", "phone"]);
  });

  it("refuses links in free text (no phishing host)", () => {
    for (const about of ["Visit https://evil.example", "go to www.evil.com", "pay at evil-bank.com now"]) {
      const r = parseContent({ ...base, about });
      expect(r.ok).toBe(false);
    }
    const svc = parseContent({ ...base, services: "Login - evil.com" });
    expect(svc.ok).toBe(false);
  });

  it("allows an email address in the email field", () => {
    expect(parseContent({ ...base, email: "owner@ekmoliya.com" }).ok).toBe(true);
  });

  it("rejects a phone with letters", () => {
    expect(parseContent({ ...base, phone: "call me maybe" }).ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(parseContent({ ...base, email: "not-an-email" }).ok).toBe(false);
  });

  it("accepts a street address in place of a town or city", () => {
    const { city, ...noCity } = base;
    const r = parseContent({ ...noCity, address: "1325 Paterson Plank Road" });
    expect(r.ok).toBe(true);
  });

  it("still requires a town or city when there is no address", () => {
    const { city, ...noCity } = base;
    const r = parseContent(noCity);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.city).toBeTruthy();
  });

  it("parses testimonials: splits name and quote, caps at three, allows unattributed", () => {
    const r = parseContent({
      ...base,
      testimonials: "Jane D — Punctual and tidy\nNo-name quote line\nMark T — Great job\nFourth is dropped",
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.testimonials).toEqual([
        { name: "Jane D", quote: "Punctual and tidy" },
        { name: "", quote: "No-name quote line" },
        { name: "Mark T", quote: "Great job" },
      ]);
  });

  it("refuses links and over-long text in testimonials", () => {
    expect(parseContent({ ...base, testimonials: "Spammer — visit www.evil.com" }).ok).toBe(false);
    expect(parseContent({ ...base, testimonials: `Jane — ${"x".repeat(301)}` }).ok).toBe(false);
  });
});

describe("customer reviews", () => {
  it("accepts a valid review; rejects bad rating, empties, links, over-long", () => {
    expect(parseReviewSubmission({ name: "Jane", rating: "5", text: "Great work" })).toEqual({
      ok: true,
      value: { name: "Jane", rating: 5, text: "Great work" },
    });
    for (const bad of [
      { name: "Jane", rating: "0", text: "x" },
      { name: "Jane", rating: "6", text: "x" },
      { name: "Jane", rating: "4.5", text: "x" },
      { name: "Jane", rating: "3", text: "" },
      { name: "", rating: "3", text: "x" },
      { name: "Jane", rating: "3", text: "see www.evil.com" },
      { name: "Jane", rating: "3", text: "x".repeat(601) },
    ]) {
      expect(parseReviewSubmission(bad).ok).toBe(false);
    }
  });

  it("computes count + one-decimal average", () => {
    const r = (rating: number): Review => ({ id: "x", name: "A", rating, text: "t", createdAt: "" });
    expect(reviewStats([])).toEqual({ count: 0, average: 0 });
    expect(reviewStats([r(5), r(4)])).toEqual({ count: 2, average: 4.5 });
    expect(reviewStats([r(5), r(5), r(4)]).average).toBe(4.7);
  });
});

describe("multiple locations", () => {
  it("parses Name | Address | Phone lines, drops incomplete ones, round-trips", () => {
    const locs = parseLocations(
      "Downtown | 123 Main St | (555) 111-2222\n456 Oak Ave | (555) 333-4444\nJust an address, no phone",
    );
    expect(locs).toEqual([
      { name: "Downtown", address: "123 Main St", phone: "(555) 111-2222" },
      { name: "", address: "456 Oak Ave", phone: "(555) 333-4444" },
    ]);
    expect(parseLocations(locationsToText(locs))).toEqual(locs);
  });
  it("validates each location's phone and rejects links", () => {
    expect(parseContent({ ...base, locations: "Downtown | 123 Main St | (555) 111-2222" }).ok).toBe(true);
    expect(parseContent({ ...base, locations: "Downtown | 123 Main St | call-us-now" }).ok).toBe(false);
    expect(parseContent({ ...base, locations: "Downtown | visit evil.com | (555) 111-2222" }).ok).toBe(false);
  });
});

describe("services", () => {
  it("splits name and price on a dash and round-trips", () => {
    const s = parseServices("Lawn mowing - from $35\nSpring cleanup — $149\nHedge trimming");
    expect(s).toEqual([
      { name: "Lawn mowing", price: "from $35" },
      { name: "Spring cleanup", price: "$149" },
      { name: "Hedge trimming", price: null },
    ]);
    expect(parseServices(servicesToText(s))).toEqual(s);
  });
});

describe("helpers", () => {
  it("slugifies names", () => {
    expect(slugify("Bella's Hair & Nails", "Secaucus")).toBe("bellas-hair-nails-secaucus");
  });
  it("treats formatting and the US +1 as the same phone", () => {
    expect(phoneIdentity("(201) 555-0100")).toBe("2015550100");
    expect(phoneIdentity("+1 201 555 0100")).toBe("2015550100");
    expect(phoneIdentity("201.555.0100")).toBe("2015550100");
  });
  it("dials US numbers with +1", () => {
    expect(telHref("(201) 555-0100")).toBe("tel:+12015550100");
  });
  it("escapes HTML and script-breaking JSON", () => {
    expect(esc(`<img onerror="x">`)).toBe("&lt;img onerror=&quot;x&quot;&gt;");
    expect(jsonForScript({ a: "</script><script>" })).not.toContain("</script>");
  });
  it("builds a factual headline when the tagline is blank", () => {
    const r = parseContent(base);
    if (r.ok) expect(headline(r.value)).toBe("Landscaping & lawn care in Secaucus, NJ");
  });
});

describe("renderSite", () => {
  const parsed = parseContent({ ...base, about: `<script>alert(1)</script>`, services: "Mowing - $35" });
  if (!parsed.ok) throw new Error("fixture invalid");
  const site: Site = {
    ...parsed.value,
    slug: "ekmoliya-landscaping-secaucus",
    photos: ["sites/ekmoliya-landscaping-secaucus/abc.jpg"],
    status: "live",
    source: "web",
    editKeyHash: "x",
    createdAt: "2026-11-15T00:00:00Z",
    updatedAt: "2026-11-15T00:00:00Z",
  };
  const html = renderSite(site, {
    siteUrl: "https://sitevault.3pandalabs.com/s/ekmoliya-landscaping-secaucus",
    assetOrigin: "https://sitevault.3pandalabs.com",
    homeUrl: "https://sitevault.3pandalabs.com",
  });

  it("clips horizontal overflow on html and body (phones must not zoom out)", () => {
    // Off-screen slide-in reveals once widened the mobile layout viewport.
    expect(html).toMatch(/html\{[^}]*overflow-x:clip/);
    expect(html).toMatch(/body\{[^}]*overflow-x:clip/);
  });
  it("escapes user text", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
  it("has call button, services, photo and LocalBusiness data", () => {
    expect(html).toContain('href="tel:+12015550100"');
    expect(html).toContain("Mowing");
    expect(html).toContain("/p/sites/ekmoliya-landscaping-secaucus/abc.jpg");
    expect(html).toContain('"@type":"LocalBusiness"');
  });
  it("shows the video ad only when the site has one", () => {
    expect(html).not.toContain("<video");
    const v = renderSite({ ...site, video: "sites/ekmoliya-landscaping-secaucus/ad.mp4" }, {
      siteUrl: "https://x/s/a",
      assetOrigin: "https://x",
      homeUrl: "https://x",
    });
    expect(v).toContain('<source src="https://x/p/sites/ekmoliya-landscaping-secaucus/ad.mp4" type="video/mp4">');
    expect(v).toContain("playsinline");
  });
  it("shows the before & after section only with pairs, labelled and escaped, in every template", () => {
    expect(html).not.toContain("Before &amp; after");
    const ctx = { siteUrl: "https://x/s/a", assetOrigin: "https://x", homeUrl: "https://x" };
    for (const template of ["spotlight", "split", "editorial"] as const) {
      const out = renderSite(
        { ...site, template, businessName: `Bob's <b>Lawns</b>`, beforeAfter: [{ before: "sites/a/b1.jpg", after: "sites/a/a1.jpg" }] },
        ctx,
      );
      expect(out).toContain('<h2 id="ba-h">Before &amp; after</h2>');
      expect(out).toContain('src="https://x/p/sites/a/b1.jpg" alt="Before: Bob&#39;s &lt;b&gt;Lawns&lt;/b&gt; job 1"');
      expect(out).toContain('alt="After: Bob&#39;s &lt;b&gt;Lawns&lt;/b&gt; job 1"');
      expect(out).toContain('<span class="ba-tag ba-tag-b">Before</span>');
      expect(out).toContain('<span class="ba-tag ba-tag-a">After</span>');
      expect(out).toContain('class="ba-cmp"'); // drag-to-compare slider
      expect(out).not.toContain("<b>Lawns</b>");
    }
  });
  it("shows a Locations popup + trigger only when there are extra locations", () => {
    expect(html).not.toContain('id="locations"');
    const ctx = { siteUrl: "https://x/s/a", assetOrigin: "https://x", homeUrl: "https://x" };
    const multi = renderSite({ ...site, locations: [{ name: "Westside", address: "456 Oak Ave", phone: "(555) 333-4444" }] }, ctx);
    expect(multi).toContain('<div id="locations" class="loc-popup"');
    expect(multi).toContain("Westside");
    expect(multi).toContain('href="tel:+15553334444"');
    expect(multi).toContain('href="#locations"');
  });
  it("always shows the Reviews section with a leave-a-review form; lists approved reviews", () => {
    expect(html).toContain('action="/review"');
    expect(html).toContain("No reviews yet");
    const ctx = { siteUrl: "https://x/s/a", assetOrigin: "https://x", homeUrl: "https://x" };
    const out = renderSite(
      { ...site, reviews: [{ id: "r1", name: "Pat", rating: 5, text: "Loved <the> work", createdAt: "2026-11-18T00:00:00Z" }] },
      ctx,
    );
    expect(out).toContain("Customer reviews");
    expect(out).toContain("Loved &lt;the&gt; work"); // escaped
    expect(out).toContain("5.0");
  });
  it("gives each site a themed SVG favicon with its initial", () => {
    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    // 'E' for EkMoliya, URL-encoded, on the landscaping primary (#143626 -> %23143626)
    expect(html).toContain("%3Ctext"); // the <text> element is present
    expect(html).toContain("%23143626"); // theme primary, encoded
  });
  it("adds the fair-housing line only for real estate", () => {
    expect(html).not.toContain("Equal Housing Opportunity");
    const re = renderSite({ ...site, category: "realestate" }, {
      siteUrl: "https://x/s/a",
      assetOrigin: "https://x",
      homeUrl: "https://x",
    });
    expect(re).toContain("Equal Housing Opportunity");
  });
  it("counts taps with ping only when asked (customer subdomain), never with script", () => {
    expect(html).not.toContain("ping=");
    const p = renderSite({ ...site, address: "1 Main St" }, { siteUrl: "https://a.x/", assetOrigin: "https://a.x", homeUrl: "https://x", ping: true });
    expect(p).toContain('ping="/t/call"');
    expect(p).toContain('ping="/t/directions"');
    expect(p).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });
  it("paused page keeps the name and a tap-to-call phone; unpublished is neutral; both noindex", () => {
    const paused = renderHold({ ...site, businessName: "Bella <b>Hair</b>" }, "paused");
    expect(paused).toContain("This site is paused");
    expect(paused).toContain("Bella &lt;b&gt;Hair&lt;/b&gt;");
    expect(paused).toContain('href="tel:+12015550100"');
    expect(paused).toContain('name="robots" content="noindex"');
    expect(paused).not.toContain("<script");
    const unpub = renderHold(site, "unpublished");
    expect(unpub).toContain("isn't published yet");
    expect(unpub).not.toContain(site.businessName);
    expect(unpub).toContain('content="noindex"');
  });
});

describe("before & after", () => {
  it("allows trades only, never health, cosmetic, body, food, retail or real estate", () => {
    for (const k of ["landscaping", "cleaning", "plumbing", "electrical", "hvac", "handyman", "auto"]) expect(beforeAfterAllowed(k)).toBe(true);
    for (const k of ["salon", "barber", "spa", "dentist", "clinic", "fitness", "restaurant", "bakery", "realestate", "petcare", "other", "nope"])
      expect(beforeAfterAllowed(k)).toBe(false);
    for (const k of BEFORE_AFTER_CATEGORIES) expect(k in CATEGORIES).toBe(true);
  });

  const f = (type = "image/jpeg", size = 10) => ({ type, size });
  const opts = { existing: 0, types: INTERNAL_BEFORE_AFTER_TYPES, maxBytes: 100 };
  it("takes complete pairs or none; refuses half pairs, too many, bad types and big files", () => {
    expect(pickBeforeAfter({}, opts)).toEqual({ ok: true, pairs: [] });
    const two = pickBeforeAfter({ ba1Before: f(), ba1After: f("image/png"), ba2Before: f("image/webp"), ba2After: f() }, opts);
    expect(two.ok && two.pairs.length).toBe(2);
    expect(pickBeforeAfter({ ba2After: f() }, opts).ok).toBe(false);
    expect(pickBeforeAfter({ ba1Before: f(), ba1After: f() }, { ...opts, existing: 2 }).ok).toBe(false);
    expect(pickBeforeAfter({ ba1Before: f("image/gif"), ba1After: f() }, opts).ok).toBe(false);
    expect(pickBeforeAfter({ ba1Before: f("image/jpeg", 101), ba1After: f() }, opts).ok).toBe(false);
  });

  it("siteFileKeys covers photos, video and both halves of each pair", () => {
    expect(siteFileKeys({ photos: ["p"], video: "v", beforeAfter: [{ before: "b", after: "a" }] })).toEqual(["p", "v", "b", "a"]);
    expect(siteFileKeys({ photos: [], video: null })).toEqual([]);
  });
});

describe("edit-page list helpers on sites saved without the list (2026-11-20)", () => {
  it("treat a missing list as empty instead of crashing", async () => {
    const m = await import("../src/site.js");
    expect(m.teamToText(undefined)).toBe("");
    expect(m.faqToText(undefined)).toBe("");
    expect(m.servicesToText(undefined)).toBe("");
    expect(m.testimonialsToText(undefined)).toBe("");
    expect(m.locationsToText(undefined)).toBe("");
  });
});
