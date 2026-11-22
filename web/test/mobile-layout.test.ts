import { describe, expect, it } from "vitest";
import { layout } from "../src/pages.js";

// SiteVault's body is a column flexbox and <main class="wrap"> has auto side
// margins, so without an explicit width main sized to its widest content
// (624px on the home page, 400px on the builder) and phones cut the page off.
describe("own pages fit a phone", () => {
  const html = layout({ title: "t", body: "<main class=\"wrap\"></main>" });
  it("gives .wrap an explicit width so main can't grow past the screen", () => {
    expect(html).toMatch(/\.wrap\{width:100%;/);
  });
  it("lets fieldsets shrink (their default min-width is their content)", () => {
    expect(html).toMatch(/fieldset\{min-width:0;/);
  });
  it("never asks a grid column for more than the container has", () => {
    const fixed = html.match(/minmax\(\d+px,1fr\)/g) ?? [];
    expect(fixed).toEqual([]);
  });
});
