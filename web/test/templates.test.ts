import { describe, expect, it } from "vitest";
import { parseContent, type Site } from "../src/site.js";
import { renderSite } from "../src/render.js";
import { asTemplate, DEFAULT_TEMPLATE, TEMPLATES, themeFor } from "../src/templates.js";

const site = (template: string, category = "landscaping"): Site => {
  const p = parseContent({ businessName: "Green Yards", category, phone: "(201) 555-0100", city: "Secaucus, NJ", template });
  if (!p.ok) throw new Error("fixture invalid");
  return { ...p.value, slug: "x", photos: ["sites/x/a.jpg"], status: "live", source: "web", editKeyHash: "x", createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z" };
};
const render = (template: string, category = "landscaping") =>
  renderSite(site(template, category), { siteUrl: "https://x/", assetOrigin: "https://x", homeUrl: "https://h" });

describe("templates", () => {
  it("there are at least three templates", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(3);
  });
  it("asTemplate coerces unknown/empty to the default", () => {
    expect(asTemplate("spotlight")).toBe("spotlight");
    expect(asTemplate("nope")).toBe(DEFAULT_TEMPLATE);
    expect(asTemplate(undefined)).toBe(DEFAULT_TEMPLATE);
  });
  it("each template renders its own hero", () => {
    expect(render("spotlight")).toContain('class="hero spotlight"');
    expect(render("split")).toContain('class="hero split"');
    expect(render("editorial")).toContain('class="hero editorial"');
  });
  it("editorial uses a serif heading font", () => {
    expect(render("editorial")).toContain("--head-font:Georgia");
    expect(render("spotlight")).not.toContain("--head-font:Georgia");
  });
  it("landscaping has a tuned palette; other categories fall back to the brand", () => {
    expect(themeFor("landscaping", "#166534").primary).toBe("#143626");
    expect(themeFor("plumbing", "#1e40af").primary).toBe("#1e40af");
    expect(render("spotlight", "plumbing")).toContain("--primary:#1e40af");
  });
});
