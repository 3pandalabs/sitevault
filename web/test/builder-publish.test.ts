// The builder (2026-11-20): the style preview is the last section, a
// reassurance banner sits above the form, and publishing asks first with an
// in-page panel (never window.confirm).
import { describe, expect, it } from "vitest";
import { billingSection, builderPage, donePage } from "../src/pages.js";
import { parseContent, type Site } from "../src/site.js";
import { planPrices } from "../src/billing.js";

const parsed = parseContent({ businessName: "Green Lawns", category: "landscaping", phone: "(201) 555-0100", city: "Secaucus, NJ" });
if (!parsed.ok) throw new Error("fixture invalid");
const site: Site = {
  ...parsed.value,
  slug: "green-lawns",
  photos: [],
  status: "live",
  source: "web",
  editKeyHash: "x",
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
};
const edit = (extra: Record<string, unknown> = {}) =>
  builderPage({ kind: "edit", site, key: "k", photoUrl: (k) => k, siteUrl: "https://green-lawns.3pandasite.com/", ...extra }, "N", {}, {}, "3pandasite.com");
const draft = (pay: boolean) =>
  builderPage({ kind: "new", account: { email: "o@example.com" }, embedDraft: { id: "d".repeat(20), photos: [], pairs: [], video: false }, publishesNow: !pay }, "N", {}, {}, "3pandasite.com");
const formTag = (h: string) => h.match(/<form id="builder"[^>]*>/)![0];

describe("style preview is the last section", () => {
  for (const [name, h] of [
    ["new", builderPage({ kind: "new" }, "N", {}, {}, "3pandasite.com")],
    ["edit", edit()],
    ["embed edit", edit({ embed: true })],
    ["embed create", draft(false)],
  ] as const) {
    it(`${name}: after every other section, just before the attest + submit`, () => {
      const style = h.indexOf('<fieldset id="website-style">');
      expect(style).toBeGreaterThan(0);
      expect(h).toContain("<legend>Preview your website in different styles</legend>");
      expect(h).toContain("Try each style to see your website with your details, then choose the one you like. You can switch anytime.");
      expect(h).not.toContain("<legend>Website style</legend>");
      for (const earlier of ["<legend>Your business</legend>", "<legend>What you offer</legend>", "<legend>Photos &amp; video</legend>"]) expect(h.indexOf(earlier)).toBeLessThan(style);
      // Nothing but the attest tick sits between it and the submit button.
      const between = h.slice(h.indexOf("</fieldset>", style), h.indexOf('id="submit"'));
      expect(between).not.toContain("<fieldset");
      expect(between).toContain('name="attest"');
    });
  }
});

describe("reassurance banner", () => {
  it("new and embed create: you'll see a preview before it goes live", () => {
    for (const h of [builderPage({ kind: "new" }, "N"), draft(true)]) {
      expect(h).toMatch(/<p class="notice" id="preview-banner"[^>]*>Don't worry: you'll see a preview of your website with your details before it goes live\.<\/p>\s*<form id="builder"/);
    }
  });

  it("a published site: changes go live only on Save", () => {
    expect(edit()).toContain(">Changes go live only when you press Save changes.</p>");
    expect(edit()).not.toContain("Don't worry");
  });

  it("an unpublished site: the preview wording", () => {
    const billing = { state: "unpublished", billing: {}, source: "web", prices: planPrices("web"), paidUntil: null, justPaid: false };
    expect(edit({ billing })).toContain("Don't worry: you'll see a preview");
  });
});

describe("confirm before publishing", () => {
  it("the create form asks first; publish wording when it goes live at once", () => {
    expect(formTag(builderPage({ kind: "new", publishesNow: true }, "N"))).toContain('data-confirm-publish="publish"');
    expect(formTag(builderPage({ kind: "new", publishesNow: false }, "N"))).toContain('data-confirm-publish="create"');
    expect(formTag(draft(false))).toContain('data-confirm-publish="publish"');
    expect(formTag(draft(true))).toContain('data-confirm-publish="create"');
  });

  it("saving edits to a site never asks", () => {
    expect(formTag(edit())).not.toContain("data-confirm-publish");
    expect(formTag(edit({ embed: true }))).not.toContain("data-confirm-publish");
  });

  it("the panel is in-page, nonce'd, and runs before the builder's own submit", () => {
    const h = builderPage({ kind: "new", publishesNow: true }, "NONCE1", {}, {}, "3pandasite.com");
    const script = h.slice(h.indexOf('<script nonce="NONCE1">'));
    expect(script).toContain("You're about to publish your website. It will be live at ");
    expect(script).toContain(" for anyone to see. Publish now?");
    expect(script).toContain("'Yes, publish'");
    expect(script).toContain("'Go back'");
    expect(script).toContain("stopImmediatePropagation");
    expect(h).not.toMatch(/window\.confirm|\balert\(|[^.]confirm\(/);
    // The page's one script still parses.
    const body = script.slice(script.indexOf(">") + 1, script.indexOf("</script>"));
    expect(() => new Function(body)).not.toThrow();
    // Registered first, so it can stop the builder's fetch until "Yes, publish".
    expect(script.indexOf("form[data-confirm-publish]")).toBeLessThan(script.indexOf("form.addEventListener('submit'"));
  });

  it("pay-to-publish buttons ask too (done page and edit page); renewals don't", () => {
    const d = donePage({ siteUrl: "https://green-lawns.3pandasite.com/", editUrl: "https://e/", nonce: "n", publish: { slug: "green-lawns", key: "k", prices: planPrices("web") } });
    const forms = d.match(/<form method="post" action="\/api\/billing\/checkout"[^>]*>/g)!;
    expect(forms.length).toBe(2);
    for (const f of forms) expect(f).toContain('data-confirm-publish="publish" data-confirm-addr="https://green-lawns.3pandasite.com/"');
    expect(d).toContain("form[data-confirm-publish]");
    const b = billingSection("green-lawns", "k", { state: "unpublished", billing: {} as never, source: "web", prices: planPrices("web"), paidUntil: null, justPaid: false }, "https://g/");
    expect(b).toContain('data-confirm-publish="publish"');
    const renew = billingSection("green-lawns", "k", { state: "grace", billing: { plan: "basic" } as never, source: "web", prices: planPrices("web"), paidUntil: new Date(), justPaid: false }, "https://g/");
    expect(renew).not.toContain("data-confirm-publish");
  });
});
