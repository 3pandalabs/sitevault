// A template is a static layout + typography style for the customer site.
// Three looks, themed per business category. Still no JavaScript, no web fonts,
// no trackers, facts only — the template only changes arrangement and palette.

import type { CategoryKey } from "./site.js";

export type TemplateKey = "spotlight" | "split" | "editorial";

export const TEMPLATES: { key: TemplateKey; label: string; blurb: string }[] = [
  { key: "spotlight", label: "Spotlight", blurb: "A big photo hero — bold and punchy." },
  { key: "split", label: "Split", blurb: "Side-by-side intro — clean and structured." },
  { key: "editorial", label: "Editorial", blurb: "Centred and refined, with elegant type." },
];

export const DEFAULT_TEMPLATE: TemplateKey = "spotlight";

export function isTemplate(x: string | undefined | null): x is TemplateKey {
  return TEMPLATES.some((t) => t.key === x);
}

/** A stored or submitted template value, coerced to a known key (default otherwise). */
export function asTemplate(x: string | undefined | null): TemplateKey {
  return isTemplate(x) ? x : DEFAULT_TEMPLATE;
}

export type Theme = {
  // Palette
  bg: string;
  band: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  primary: string;
  accent: string;
  // Design-family tokens (the "look & feel", not just colour)
  headFont: string; // heading font stack (system fonts only)
  radius: string; // card / element corner radius
  btnRadius: string; // button corner radius (e.g. pill for beauty)
  pad: string; // section vertical padding — spacing density
  revealDur: string; // scroll-reveal / transition speed — motion feel
  headWeight: string; // heading font-weight
  headSpacing: string; // heading letter-spacing
};

const SANS = `system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`;
const SERIF = `Georgia,Cambria,"Times New Roman",serif`;

// Shared defaults for categories not yet tuned; a family bundle overrides these.
const BASE = { headFont: SANS, radius: "12px", btnRadius: "12px", pad: "48px", revealDur: ".7s", headWeight: "700", headSpacing: "-.005em" };

// Design families: a bundle of tokens shared by related categories. Each keeps
// white text 4.5:1 on `primary` and dark text on `bg`/`card`.
const TRADE = { ...BASE, headFont: SANS, radius: "8px", btnRadius: "8px", pad: "42px", revealDur: ".45s", headWeight: "800", headSpacing: "-.015em" };
const BEAUTY = { ...BASE, headFont: SERIF, radius: "18px", btnRadius: "999px", pad: "64px", revealDur: ".9s", headWeight: "600", headSpacing: "-.01em" };
const FOOD = { ...BASE, headFont: SERIF, radius: "10px", btnRadius: "6px", pad: "56px", revealDur: ".7s", headWeight: "700", headSpacing: "-.01em" };

// Hand-tuned categories (palette from the local-business blueprints + a family).
// Others fall back to a clean light palette from their brand colour + BASE tokens.
const THEMES: Partial<Record<CategoryKey, Theme>> = {
  landscaping: { bg: "#F7F9F6", band: "#ECF2E8", card: "#FFFFFF", ink: "#14271D", muted: "#4F6152", line: "#DEE8DA", primary: "#143626", accent: "#65A30D", ...TRADE, revealDur: ".6s" },
  plumbing: { bg: "#FFFFFF", band: "#EEF2FB", card: "#F4F7FC", ink: "#0F1B33", muted: "#475569", line: "#DBE4F2", primary: "#1E3A8A", accent: "#DC2626", ...TRADE },
  salon: { bg: "#FDF8F6", band: "#F8EEEA", card: "#FFFFFF", ink: "#2A211E", muted: "#7B6A64", line: "#EFE0DB", primary: "#9D174D", accent: "#BE185D", ...BEAUTY },
  restaurant: { bg: "#FBF6EE", band: "#F3E8D9", card: "#FFFFFF", ink: "#2A1E16", muted: "#6B5A4A", line: "#E8DCC9", primary: "#9A3412", accent: "#C2410C", ...FOOD },
};

export function themeFor(category: CategoryKey, brand: string): Theme {
  return THEMES[category] ?? { bg: "#F8FAF9", band: "#F1F5F4", card: "#FFFFFF", ink: "#111827", muted: "#4B5563", line: "#E5E7EB", primary: brand, accent: brand, ...BASE };
}
