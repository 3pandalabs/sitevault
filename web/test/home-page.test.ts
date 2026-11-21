import { describe, expect, it } from "vitest";
import { homePage } from "../src/pages.js";

describe("home page", () => {
  const h = homePage(true, null, false, false);

  it("has no business-type chips row (or its CSS)", () => {
    expect(h).not.toContain('class="chips"');
    expect(h).not.toContain(".chips");
    expect(h).not.toContain("<span>Landscapers</span>");
  });

  it("titles the three steps like the features section", () => {
    expect(h).toMatch(/<section id="how-it-works">\s*<h2>Three simple steps<\/h2>\s*<div class="steps">/);
    expect(h.indexOf('id="how-it-works"')).toBeLessThan(h.indexOf('id="features"'));
    expect(h).toContain("1. Tell us the basics");
  });
});
