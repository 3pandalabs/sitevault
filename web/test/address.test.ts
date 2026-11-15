import { describe, expect, it } from "vitest";
import { addressProblem, normaliseAddress, suggestAddresses } from "../src/address.js";

describe("addressProblem", () => {
  it("accepts ordinary business names", () => {
    for (const ok of ["ekmoliya", "ekmoliya-landscaping", "bellas-hair", "first-choice-plumbing", "purchase-street-deli", "pineapple-bakery", "pups-and-pals"]) {
      expect(addressProblem(ok), ok).toBeNull();
    }
  });
  it("refuses bad shapes", () => {
    expect(addressProblem("ab")).toMatch(/at least/);
    expect(addressProblem("a".repeat(41))).toMatch(/at most/);
    expect(addressProblem("-bella")).toMatch(/hyphen/);
    expect(addressProblem("bella--hair")).toMatch(/single/);
    expect(addressProblem("Bella")).toMatch(/lowercase/);
  });
  it("refuses reserved names and brands (phishing)", () => {
    expect(addressProblem("admin")).toMatch(/reserved/);
    expect(addressProblem("login")).toMatch(/reserved/);
    for (const bad of ["paypal-login", "secure-paypal", "wellsfargo-help", "chase-bank", "irs-refund", "apple-id", "google"]) {
      expect(addressProblem(bad), bad).toMatch(/company's name/);
    }
  });
});

describe("normaliseAddress", () => {
  it("turns typing into an address", () => {
    expect(normaliseAddress("Bella's Hair!")).toBe("bellas-hair");
    expect(normaliseAddress("https://ekmoliya.3pandasite.com")).toBe("ekmoliya");
  });
});

describe("suggestAddresses", () => {
  it("is shortest first: name, name-type, name-town", () => {
    expect(suggestAddresses("EkMoliya", "landscaping", "Secaucus, NJ")).toEqual([
      "ekmoliya",
      "ekmoliya-landscaping",
      "ekmoliya-secaucus",
      "ekmoliya-landscaping-secaucus",
    ]);
  });
  it("doesn't repeat the type when the name has it", () => {
    expect(suggestAddresses("Bella Salon", "salon", "Hoboken")[1]).toBe("bella-salon-hoboken");
  });
  it("drops names that break the rules", () => {
    expect(suggestAddresses("PayPal Fixers", "handyman", "Newark").length).toBe(0);
  });
});
