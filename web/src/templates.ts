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

/** A stored or submitted template value, coerced to a known key (default otherwise). */
export function asTemplate(x: string | undefined | null): TemplateKey {
  return TEMPLATES.some((t) => t.key === x) ? (x as TemplateKey) : DEFAULT_TEMPLATE;
}

export type Theme = {
  bg: string;
  band: string;
  card: string;
  ink: string;
  muted: string;
  line: string;
  primary: string;
  accent: string;
};

// Hand-tuned category palettes (from the local-business blueprints). Categories
// not listed fall back to a clean light palette derived from their brand colour;
// Phase 2 tunes each one. Every palette keeps white text 4.5:1 on `primary`
// (the brand colours are already dark enough) and dark text on `bg`/`card`.
const THEMES: Partial<Record<CategoryKey, Theme>> = {
  landscaping: { bg: "#F7F9F6", band: "#ECF2E8", card: "#FFFFFF", ink: "#14271D", muted: "#4F6152", line: "#DEE8DA", primary: "#143626", accent: "#65A30D" },
};

export function themeFor(category: CategoryKey, brand: string): Theme {
  return THEMES[category] ?? { bg: "#F8FAF9", band: "#F1F5F4", card: "#FFFFFF", ink: "#111827", muted: "#4B5563", line: "#E5E7EB", primary: brand, accent: brand };
}
