import { describe, expect, it } from "vitest";
import { homePage } from "../src/pages.js";

describe("prices always carry a $", () => {
  it("home page never shows a bare price number after 'it's' or 'pay'", () => {
    const h = homePage(true, null, false, false);
    expect(h).toContain("it's $10 with the first year of Pro");
    expect(h).toContain("Make a YouTube ad, $10");
    expect(h).not.toMatch(/(it's|pay) \d/);
  });
});
