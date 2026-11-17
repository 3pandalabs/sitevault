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
const CLINICAL = { ...BASE, headFont: SANS, radius: "10px", btnRadius: "8px", pad: "56px", revealDur: ".55s", headWeight: "700", headSpacing: "-.01em" };
const ACTIVE = { ...BASE, headFont: SANS, radius: "6px", btnRadius: "6px", pad: "44px", revealDur: ".4s", headWeight: "800", headSpacing: "0" };
const PREMIUM = { ...BASE, headFont: SERIF, radius: "8px", btnRadius: "4px", pad: "64px", revealDur: ".8s", headWeight: "600", headSpacing: "-.015em" };
const FRIENDLY = { ...BASE, headFont: SANS, radius: "20px", btnRadius: "999px", pad: "52px", revealDur: ".65s", headWeight: "700", headSpacing: "-.005em" };

// Every category has a tuned palette + a design family. Each primary keeps white
// text 4.5:1 and dark text sits on bg/card. (themeFor still has a brand fallback
// for any future category added without a bundle here.)
const THEMES: Partial<Record<CategoryKey, Theme>> = {
  // Trades — bold, squared, snappy
  landscaping: { bg: "#F7F9F6", band: "#ECF2E8", card: "#FFFFFF", ink: "#14271D", muted: "#4F6152", line: "#DEE8DA", primary: "#143626", accent: "#65A30D", ...TRADE, revealDur: ".6s" },
  plumbing: { bg: "#FFFFFF", band: "#EEF2FB", card: "#F4F7FC", ink: "#0F1B33", muted: "#475569", line: "#DBE4F2", primary: "#1E3A8A", accent: "#DC2626", ...TRADE },
  cleaning: { bg: "#F0F9FF", band: "#E0F2FE", card: "#FFFFFF", ink: "#0C2A3A", muted: "#4B6475", line: "#D4E9F2", primary: "#0369A1", accent: "#10B981", ...TRADE },
  electrical: { bg: "#F8FAFC", band: "#EEF1F5", card: "#FFFFFF", ink: "#0F172A", muted: "#475569", line: "#E2E8F0", primary: "#1E293B", accent: "#F59E0B", ...TRADE },
  hvac: { bg: "#F7FAFC", band: "#EAF2F7", card: "#FFFFFF", ink: "#0F2733", muted: "#4B5F6B", line: "#DCE8EF", primary: "#0C4A6E", accent: "#EA580C", ...TRADE },
  handyman: { bg: "#FAF8F5", band: "#F2EBE2", card: "#FFFFFF", ink: "#292524", muted: "#6B5E52", line: "#E7DDD0", primary: "#78350F", accent: "#D97706", ...TRADE },
  auto: { bg: "#F4F4F5", band: "#EBEBEE", card: "#FFFFFF", ink: "#18181B", muted: "#52525B", line: "#E0E0E4", primary: "#1F2937", accent: "#EA580C", ...TRADE },
  // Beauty — elegant serif, soft, pill, airy, slow
  salon: { bg: "#FDF8F6", band: "#F8EEEA", card: "#FFFFFF", ink: "#2A211E", muted: "#7B6A64", line: "#EFE0DB", primary: "#9D174D", accent: "#BE185D", ...BEAUTY },
  barber: { bg: "#F6F4F1", band: "#ECE7E1", card: "#FFFFFF", ink: "#292524", muted: "#6B6259", line: "#E6DED5", primary: "#292524", accent: "#B45309", ...BEAUTY },
  spa: { bg: "#F4F5F0", band: "#EAEDE4", card: "#FFFFFF", ink: "#2C362E", muted: "#5E6B60", line: "#DFE4D9", primary: "#2C362E", accent: "#84A98C", ...BEAUTY },
  // Food — warm, editorial serif
  restaurant: { bg: "#FBF6EE", band: "#F3E8D9", card: "#FFFFFF", ink: "#2A1E16", muted: "#6B5A4A", line: "#E8DCC9", primary: "#9A3412", accent: "#C2410C", ...FOOD },
  bakery: { bg: "#FFFBEB", band: "#FCF3DD", card: "#FFFFFF", ink: "#451A03", muted: "#78614A", line: "#F0E4C8", primary: "#92400E", accent: "#D97706", ...FOOD },
  // Clinical — clean, crisp, calm
  dentist: { bg: "#F8FAFC", band: "#ECF4F7", card: "#FFFFFF", ink: "#0F2A33", muted: "#4B6470", line: "#DCEAEF", primary: "#0F766E", accent: "#38BDF8", ...CLINICAL },
  clinic: { bg: "#FFFFFF", band: "#F1F5F9", card: "#FFFFFF", ink: "#0F172A", muted: "#475569", line: "#E2E8F0", primary: "#1E3A8A", accent: "#059669", ...CLINICAL },
  // Active — bold, punchy
  fitness: { bg: "#FAFAFA", band: "#F0F0F0", card: "#FFFFFF", ink: "#09090B", muted: "#52525B", line: "#E4E4E7", primary: "#18181B", accent: "#EAB308", ...ACTIVE },
  // Premium — refined, luxe spacing
  realestate: { bg: "#F8FAFC", band: "#EEF1F5", card: "#FFFFFF", ink: "#0F172A", muted: "#475569", line: "#E2E8F0", primary: "#1E3A5F", accent: "#C29B61", ...PREMIUM },
  other: { bg: "#FAFAFA", band: "#F0F0F3", card: "#FFFFFF", ink: "#111827", muted: "#4B5563", line: "#E5E7EB", primary: "#4338CA", accent: "#4F46E5", ...PREMIUM },
  // Friendly — rounded, playful
  petcare: { bg: "#FFFDF7", band: "#FEF3E7", card: "#FFFFFF", ink: "#1E293B", muted: "#596577", line: "#F2E6D5", primary: "#C2410C", accent: "#14B8A6", ...FRIENDLY },
};

export function themeFor(category: CategoryKey, brand: string): Theme {
  return THEMES[category] ?? { bg: "#F8FAF9", band: "#F1F5F4", card: "#FFFFFF", ink: "#111827", muted: "#4B5563", line: "#E5E7EB", primary: brand, accent: brand, ...BASE };
}
