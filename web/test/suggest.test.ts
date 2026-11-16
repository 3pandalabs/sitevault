import { describe, expect, it } from "vitest";
import { builderPage } from "../src/pages.js";
import { renderSite } from "../src/render.js";
import { parseContent, type Site } from "../src/site.js";
import { SUGGEST_FIELDS, SUGGEST_SCRIPT, suggestionsFor, townOf } from "../src/suggest.js";
import { TEMPLATES } from "../src/templates.js";

const parsed = parseContent({
  businessName: "EkMoliya Landscaping",
  category: "landscaping",
  phone: "(201) 555-0100",
  city: "Secaucus, NJ",
});
if (!parsed.ok) throw new Error("fixture invalid");
const site: Site = {
  ...parsed.value,
  slug: "ekmoliya",
  photos: [],
  status: "live",
  source: "web",
  editKeyHash: "x",
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
};

const chipsIn = (html: string, field: string): string[] => {
  const box = html.match(new RegExp(`<div class="suggest" data-suggest-for="${field}">(.*?)</div>`, "s"));
  return box ? [...box[1]!.matchAll(/<button[^>]*>/g)].map((m) => m[0]) : [];
};

describe("one-tap suggestions on the edit page", () => {
  const html = builderPage({ kind: "edit", site, key: "k", photoUrl: (k) => k }, "NONCE");

  it("renders chips for every covered field, from the business's own details", () => {
    for (const f of SUGGEST_FIELDS) expect(chipsIn(html, f).length, f).toBeGreaterThan(0);
    expect(html).toContain('data-suggest="Your trusted lawn care company in Secaucus"');
    expect(html).toContain('data-suggest="Secaucus and nearby towns"');
    expect(html).toContain('data-suggest="Secaucus Lawn Care"');
    expect(html).toContain("EkMoliya Landscaping is a lawn care company serving Secaucus");
  });

  it("chips are type=button (never submit) and at most 3 per field", () => {
    for (const f of SUGGEST_FIELDS) {
      const chips = chipsIn(html, f);
      expect(chips.length, f).toBeLessThanOrEqual(3);
      for (const b of chips) {
        expect(b).toContain('type="button"');
        expect(b).toContain(`data-target="${f}"`);
      }
    }
    expect(html.match(/data-suggest="/g)!.length).toBe(html.match(/<button type="button" class="suggest-chip"/g)!.length);
  });

  it("skips password, email, phone, street address and the web address", () => {
    for (const f of ["phone", "email", "address", "slug", "acct_email", "acct_password"]) expect(chipsIn(html, f)).toEqual([]);
    expect(html).not.toContain('data-target="phone"');
    expect(html).not.toContain('data-target="email"');
  });

  it("the click handler ships inside the page's nonce'd script", () => {
    expect(html).toContain('<script nonce="NONCE">');
    const script = html.slice(html.indexOf('<script nonce="NONCE">'));
    expect(script).toContain("[data-suggest]");
    expect(script).toContain("b.type='button'");
    expect(html.match(/<script/g)!.length).toBe(1);
  });

  it("keeps multi-line values (hours) intact", () => {
    expect(html).toContain('data-suggest="Monday: 9:00 am - 5:00 pm&#10;Tuesday');
  });
});

describe("one-tap suggestions on a blank new form", () => {
  const html = builderPage({ kind: "new" }, "N");
  it("shows only suggestions that need nothing unknown", () => {
    expect(chipsIn(html, "businessName")).toEqual([]);
    expect(chipsIn(html, "city")).toEqual([]);
    expect(chipsIn(html, "offer").length).toBeGreaterThan(0);
    expect(chipsIn(html, "hours").length).toBe(3);
    const form = html.slice(0, html.indexOf("<script"));
    expect(form).not.toContain("{town}");
    expect(form).not.toContain("{noun}");
  });
  it("uses re-rendered form values (after a validation error)", () => {
    const h = builderPage({ kind: "new" }, "N", {}, { businessName: "Joe's", category: "plumbing", address: "1 Main St, Hoboken, NJ 07030" });
    expect(h).toContain('data-suggest="Hoboken"');
    expect(h).toContain('data-suggest="Hoboken Plumbing"');
    expect(h).toContain("Joe&#39;s is a plumber serving Hoboken");
  });
});

describe("suggestion rules", () => {
  it("derives the town from city, else address, else service area", () => {
    expect(townOf({ city: "Secaucus, NJ" })).toBe("Secaucus");
    expect(townOf({ address: "1 Main St, Hoboken, NJ 07030" })).toBe("Hoboken");
    expect(townOf({ serviceArea: "Union City, Weehawken" })).toBe("Union City");
    expect(townOf({})).toBe("");
  });
  it("never suggests a city it doesn't know", () => {
    expect(suggestionsFor("city", {})).toEqual([]);
  });
  it("de-duplicates and caps at three", () => {
    for (const f of SUGGEST_FIELDS) expect(suggestionsFor(f, { businessName: "A", category: "salon", city: "B" }).length).toBeLessThanOrEqual(3);
  });
  it("client script is plain JS with the same template table", () => {
    expect(SUGGEST_SCRIPT).toContain('"tagline"');
    expect(SUGGEST_SCRIPT).toContain("replace(/\\{(\\w+)\\}/g");
  });
});

describe("customer sites never get chips", () => {
  for (const t of TEMPLATES) {
    it(`template ${t.key}`, () => {
      const html = renderSite(
        { ...site, template: t.key },
        { siteUrl: "https://ekmoliya.3pandasite.com", assetOrigin: "https://ekmoliya.3pandasite.com", homeUrl: "https://sitevault.3pandalabs.com", nonce: "N" },
      );
      expect(html).not.toContain("data-suggest");
      expect(html).not.toContain("suggest-chip");
      expect(html).not.toContain("✨ Use:");
    });
  }
});
