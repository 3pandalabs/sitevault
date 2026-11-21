import { describe, expect, it } from "vitest";
import { homePage, shownEmail } from "../src/pages.js";

describe("signed-in state on the home page", () => {
  it("says who is signed in, in the hero and the header", () => {
    const html = homePage(false, null, true, true, false, undefined, "owner@example.com");
    expect(html).toContain("You're signed in as <b>owner@example.com</b>");
    expect(html).toContain('class="plain signed-in"');
    expect(html).toContain("Sign out");
  });

  it("shows nothing extra when signed out", () => {
    const html = homePage(false, null, false, false, false);
    expect(html).not.toContain("You're signed in");
    expect(html).not.toContain("signed-in\"");
  });

  it("never shows an AdVault test account's placeholder address", () => {
    expect(shownEmail("acct@test.invalid")).toBeNull();
    expect(shownEmail("")).toBeNull();
    const html = homePage(false, null, true, true, false, undefined, "acct@test.invalid");
    expect(html).toContain("You're signed in.");
    expect(html).not.toContain("test.invalid");
  });
});
