import { describe, expect, it } from "vitest";
import { headline, parseContent, parseServices, servicesToText } from "../src/site.js";
import { renderSite } from "../src/render.js";
import { esc, jsonForScript, slugify, telHref } from "../src/util.js";
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
  it("adds the fair-housing line only for real estate", () => {
    expect(html).not.toContain("Equal Housing Opportunity");
    const re = renderSite({ ...site, category: "realestate" }, {
      siteUrl: "https://x/s/a",
      assetOrigin: "https://x",
      homeUrl: "https://x",
    });
    expect(re).toContain("Equal Housing Opportunity");
  });
});
