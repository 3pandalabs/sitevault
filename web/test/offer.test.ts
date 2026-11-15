import { describe, expect, it } from "vitest";
import { internalOfferSpend, offerRefDecision } from "../src/billing.js";
import { parseContent, parseInternalOffer } from "../src/site.js";
import { advaultOfferLink } from "../src/pages.js";

describe("parseInternalOffer (AdVault offer combo)", () => {
  const ok = { offer: "Spring cleanup from $149", payment: "advault", ref: "pur_123-abc" };

  it("accepts a valid body and trims the offer", () => {
    expect(parseInternalOffer({ ...ok, offer: "  Spring cleanup from $149  " })).toEqual({
      ok: true,
      value: { offer: "Spring cleanup from $149", payment: "advault", ref: "pur_123-abc" },
    });
    expect(parseInternalOffer({ ...ok, payment: "credit" }).ok).toBe(true);
  });

  it("uses the edit form's offer rules (links, length)", () => {
    for (const offer of ["Visit www.example.com", "See https://x.test", "Deals at shop.com", "x".repeat(161)]) {
      const r = parseInternalOffer({ ...ok, offer });
      const form = parseContent({ businessName: "A", category: "other", phone: "(201) 555-0100", city: "B", offer });
      expect(r.ok).toBe(false);
      expect(form.ok).toBe(false);
      if (!r.ok && !form.ok) expect(r.error).toBe(`offer: ${form.errors.offer}`);
    }
    expect(parseInternalOffer({ ...ok, offer: "x".repeat(160) }).ok).toBe(true);
  });

  it("refuses an empty offer, unknown payment, bad ref, non-object body", () => {
    expect(parseInternalOffer({ ...ok, offer: "  " }).ok).toBe(false);
    expect(parseInternalOffer({ ...ok, payment: "free" }).ok).toBe(false);
    expect(parseInternalOffer({ ...ok, ref: "" }).ok).toBe(false);
    expect(parseInternalOffer({ ...ok, ref: "a b" }).ok).toBe(false);
    expect(parseInternalOffer({ ...ok, ref: "x".repeat(101) }).ok).toBe(false);
    expect(parseInternalOffer(null).ok).toBe(false);
    expect(parseInternalOffer("offer").ok).toBe(false);
  });
});

describe("internalOfferSpend", () => {
  it("advault payment never spends a credit", () => {
    expect(internalOfferSpend("advault", null, "New", 0, true)).toEqual({ spend: 0, creditShort: false });
    expect(internalOfferSpend("advault", null, "New", 5, true)).toEqual({ spend: 0, creditShort: false });
  });
  it("credit payment spends 1 when billing is on and the offer changes", () => {
    expect(internalOfferSpend("credit", "Old", "New", 2, true)).toEqual({ spend: 1, creditShort: false });
  });
  it("credit payment is free when billing is off or the offer is unchanged", () => {
    expect(internalOfferSpend("credit", "Old", "New", 0, false)).toEqual({ spend: 0, creditShort: false });
    expect(internalOfferSpend("credit", "Same", "Same", 0, true)).toEqual({ spend: 0, creditShort: false });
  });
  it("no credit left: still set, flagged short, nothing spent", () => {
    expect(internalOfferSpend("credit", "Old", "New", 0, true)).toEqual({ spend: 0, creditShort: true });
  });
});

describe("offerRefDecision", () => {
  it("a stored result replays; nothing stored applies", () => {
    const first = { ok: true, slug: "a", offer: "x", credits: 1 };
    expect(offerRefDecision(first)).toEqual({ replay: true, result: first });
    expect(offerRefDecision(null)).toEqual({ replay: false });
  });
});

describe("advaultOfferLink", () => {
  it("AdVault-made sites deep-link to the combo", () => {
    const html = advaultOfferLink({ slug: "ek-lawn", source: "advault" });
    expect(html).toContain('href="https://advault.3pandalabs.com/dashboard?siteOffer=ek-lawn"');
    expect(html).toContain("Also run this offer as a YouTube ad with AdVault");
  });
  it("other sites link to AdVault's home", () => {
    const html = advaultOfferLink({ slug: "ek-lawn", source: "web" });
    expect(html).toContain('href="https://advault.3pandalabs.com"');
    expect(html).toContain("Turn this offer into a video ad");
    expect(html).not.toContain("siteOffer");
  });
});
