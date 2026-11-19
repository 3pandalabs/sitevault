// What a site IS, and the rules for accepting one. Pure: no KV, no R2.
//
// The integrity rule, same as AdVault's ads: a site shows ONLY facts the
// business typed. Nothing is invented. And because these pages live on a
// 3PandaLabs hostname, free text may not contain links: a site is a business
// card, not a page that can send visitors elsewhere (that is how a free page
// builder becomes a phishing host).

import type { Billing } from "./billing.js";
import { asTemplate, type TemplateKey } from "./templates.js";

export const CATEGORIES = {
  landscaping: { label: "Landscaping & lawn care", brand: "#166534" },
  cleaning: { label: "Cleaning", brand: "#115e59" },
  plumbing: { label: "Plumbing", brand: "#1e40af" },
  electrical: { label: "Electrical", brand: "#854d0e" },
  hvac: { label: "Heating & cooling", brand: "#1e3a8a" },
  handyman: { label: "Handyman & repairs", brand: "#7c2d12" },
  salon: { label: "Hair & beauty salon", brand: "#9d174d" },
  barber: { label: "Barber", brand: "#1f2937" },
  spa: { label: "Spa & wellness", brand: "#6b21a8" },
  restaurant: { label: "Restaurant & cafe", brand: "#9a3412" },
  bakery: { label: "Bakery", brand: "#92400e" },
  dentist: { label: "Dentist", brand: "#0e7490" },
  clinic: { label: "Medical clinic", brand: "#075985" },
  fitness: { label: "Fitness & yoga", brand: "#991b1b" },
  auto: { label: "Auto repair", brand: "#374151" },
  realestate: { label: "Real estate", brand: "#1e3a5f" },
  petcare: { label: "Pet care", brand: "#3f6212" },
  other: { label: "Other local business", brand: "#334155" },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

/**
 * A starting list of common services per business type, prefilled into the
 * builder's "Services and prices" box when the owner picks a category (only
 * while the box is empty or still holds an untouched suggestion). Names only,
 * no prices: the owner fills in their own — we never invent a business's prices.
 */
export const SERVICE_TEMPLATES: Record<CategoryKey, string> = {
  landscaping: "Lawn mowing\nSpring & fall cleanup\nHedge & shrub trimming\nMulching\nLeaf removal\nWeeding",
  cleaning: "Standard home cleaning\nDeep cleaning\nMove-in / move-out cleaning\nOffice cleaning\nCarpet cleaning",
  plumbing: "Leak repair\nDrain cleaning\nWater heater install\nFaucet & fixture install\nToilet repair\nEmergency call-out",
  electrical: "Outlet & switch install\nLighting installation\nCeiling fan install\nPanel upgrade\nTroubleshooting & repairs",
  hvac: "AC repair\nAC installation\nFurnace repair\nHeating installation\nSeasonal tune-up\nDuct cleaning",
  handyman: "Furniture assembly\nTV mounting\nDrywall repair\nPainting touch-ups\nDoor & lock repair\nGeneral repairs",
  salon: "Haircut & style\nHair colour\nHighlights\nBlow-dry\nManicure\nPedicure",
  barber: "Haircut\nBeard trim\nHot towel shave\nKids' haircut\nLine-up",
  spa: "Swedish massage\nDeep tissue massage\nFacial\nBody scrub\nAromatherapy",
  restaurant: "Dine-in\nTakeout & delivery\nCatering\nPrivate events\nDaily specials",
  bakery: "Custom cakes\nBirthday cakes\nWedding cakes\nCupcakes & pastries\nCatering orders",
  dentist: "Routine cleaning & exam\nFillings\nTeeth whitening\nCrowns & bridges\nRoot canal\nEmergency visits",
  clinic: "General consultation\nHealth check-up\nVaccinations\nLab tests\nMinor procedures",
  fitness: "Personal training\nGroup classes\nYoga classes\nMonthly membership\nDrop-in session",
  auto: "Oil change\nBrake service\nTire rotation & replacement\nEngine diagnostics\nAC service\nState inspection",
  realestate: "Buyer representation\nSeller listing\nHome valuation\nProperty management\nRental search",
  petcare: "Dog walking\nPet sitting\nGrooming\nBoarding\nNail trim",
  other: "",
};

/**
 * A weekly opening-hours skeleton prefilled into the builder's hours box when
 * it's empty, so the owner edits times rather than typing the whole week. Day
 * labels match what the customer site's schedule renders; the owner adjusts or
 * clears it, and it's kept once touched.
 */
export const HOURS_TEMPLATE = [
  "Monday: 9:00 am - 5:00 pm",
  "Tuesday: 9:00 am - 5:00 pm",
  "Wednesday: 9:00 am - 5:00 pm",
  "Thursday: 9:00 am - 5:00 pm",
  "Friday: 9:00 am - 5:00 pm",
  "Saturday: Closed",
  "Sunday: Closed",
].join("\n");

export type Service = { name: string; price: string | null };

/** One customer testimonial: what they said, and who said it (name may be blank). */
export type Testimonial = { name: string; quote: string };

/**
 * A review left by a visitor to the published site (not the owner). Pending ones
 * live in KV (`revq:<slug>:<id>`) until the owner approves; approved ones are
 * denormalised onto the site record (`site.reviews`) so the public page needs no
 * extra lookup to render them.
 */
export type Review = { id: string; name: string; rating: number; text: string; createdAt: string };

/**
 * An extra business location beyond the primary one (address/city/phone). A
 * gym chain, say, lists each branch with its own address and phone; the site
 * shows a "Locations" button that opens a popup of all of them.
 */
export type Location = { name: string; address: string; phone: string };

/** A team member shown in the "Meet the team" section: their name and role. */
export type TeamMember = { name: string; role: string };

export type SiteContent = {
  businessName: string;
  category: CategoryKey;
  tagline: string;
  about: string;
  phone: string;
  email: string | null;
  address: string | null;
  city: string;
  serviceArea: string | null;
  hours: string | null;
  services: Service[];
  testimonials: Testimonial[];
  /** Extra locations beyond the primary address/city/phone. Empty = single location. */
  locations: Location[];
  offer: string | null;
  /** Which customer-site template (layout/style) to render. */
  template: TemplateKey;
  /** Show the first photo as the big hero banner (else a coloured banner). Default true. */
  heroPhoto: boolean;
  /** Dentist/clinic: insurance plans accepted, one per line. Empty = not shown. */
  insurance: string | null;
  /** "Meet the team" members (name + role). Empty = section not shown. */
  team: TeamMember[];
};

/** The legal/policy pages every customer site carries (copy in policies.ts). */
export type PolicyKind = "privacy" | "accessibility" | "cookies" | "terms";

export type Site = SiteContent & {
  slug: string;
  photos: string[];
  /**
   * Made by a 3PandaLabs admin for testing: may share a phone number with
   * other sites, and never claims its number (so it can't block a customer).
   */
  adminTest?: boolean;
  /**
   * Before & after photo pairs of the business's own work (R2 keys under
   * sites/<slug>/, like photos). Up to MAX_BEFORE_AFTER. Absent = none.
   */
  beforeAfter?: BeforeAfter[];
  /**
   * Menu files a restaurant/bakery uploaded (R2 keys under sites/<slug>/, image
   * or PDF). Shown in a "Menu" section. Up to MAX_MENU. Absent = none.
   */
  menu?: string[];
  /** R2 key of a fitness business's uploaded class schedule (image or PDF). */
  schedule?: string;
  /** Approved customer reviews (visitor-submitted, owner-moderated). Absent = none. */
  reviews?: Review[];
  /** R2 key of the business's video ad (AdVault sites only). */
  video?: string | null;
  /** Earlier addresses, each a permanent redirect to this one. */
  aliases?: string[];
  /** How many times the address was changed (capped). */
  renames?: number;
  /** Another live site had the same name in the same town at creation: admin review. */
  possibleDuplicateOf?: string;
  /**
   * Owner edits of the legal/policy pages (privacy, accessibility, cookies,
   * terms). A missing key means the auto-generated default is shown and stays
   * current; see policies.ts. Absent = every page is on its default.
   */
  policies?: Partial<Record<PolicyKind, string>>;
  status: "live" | "removed";
  source: "web" | "advault";
  editKeyHash: string;
  /** Owner account id (accounts.ts). Absent = made before accounts, or not yet claimed. */
  ownerId?: string | null;
  /** Paid plans (billing.ts). Absent = made before billing started (early access). */
  billing?: Billing;
  createdAt: string;
  updatedAt: string;
};

export const MAX_PHOTOS = 8;
// Phone photos are large (a modern phone shoots 4-12 MB), and the browser's
// pre-upload shrink can't always run (HEIC it can't decode, no createImageBitmap).
// Accept the original: Cloudflare Images resizes it to a web-sized JPEG on store.
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
// HEIC/HEIF are the iPhone default; Cloudflare Images converts them to JPEG.
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const MAX_SERVICES = 12;
export const MAX_TESTIMONIALS = 3;
// Customer reviews (visitor-submitted, owner-moderated).
export const MAX_APPROVED_REVIEWS = 24; // shown on the site, newest first
export const MAX_PENDING_REVIEWS = 30; // queued awaiting moderation, per site
export const REVIEWS_PER_IP_PER_DAY = 3; // a visitor can leave at most this many
const MAX_REVIEW_NAME = 60;
const MAX_REVIEW_TEXT = 600;
export const MAX_LOCATIONS = 8; // extra locations beyond the primary
const MAX_LOCATION_NAME = 60;
const MAX_LOCATION_ADDRESS = 160;

/** One before & after pair: R2 keys of the two photos. */
export type BeforeAfter = { before: string; after: string };
export const MAX_BEFORE_AFTER = 2;
/** Multipart file fields for new pairs, [before, after] per pair (AdVault's contract). */
export const BEFORE_AFTER_FIELDS = [
  ["ba1Before", "ba1After"],
  ["ba2Before", "ba2After"],
] as const;
export type BeforeAfterField = (typeof BEFORE_AFTER_FIELDS)[number][number];
/** What AdVault may send for a pair: no HEIC (its photos are already web images). */
export const INTERNAL_BEFORE_AFTER_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * The trades where "before & after" photos of the work fit: building, repair,
 * outdoor, cleaning and vehicle work. Never health, medical, dental, cosmetic,
 * salon, spa, fitness or anything about bodies (Google restricts before/after
 * imagery of personal health and cosmetic results), nor food, retail or real
 * estate. The ONE list SiteVault checks before an owner may add pairs here.
 */
export const BEFORE_AFTER_CATEGORIES: readonly CategoryKey[] = [
  "landscaping",
  "cleaning",
  "plumbing",
  "electrical",
  "hvac",
  "handyman",
  "auto",
];

export function beforeAfterAllowed(category: string): boolean {
  return (BEFORE_AFTER_CATEGORIES as readonly string[]).includes(category);
}

// ---------------------------------------------------------------------------
// Menu upload (restaurants & bakeries)

export const MAX_MENU = 6; // menu files per site (e.g. food, drinks, specials, pages)
export const MAX_MENU_BYTES = 10 * 1024 * 1024;
/** A menu file is an image or a PDF; stored as-is so the text stays legible. */
export const MENU_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MENU_TYPES = [...MENU_IMAGE_TYPES, "application/pdf"];

/** The food categories where a "Menu" section fits. The ONE list we check. */
export const MENU_CATEGORIES: readonly CategoryKey[] = ["restaurant", "bakery"];

export function menuAllowed(category: string): boolean {
  return (MENU_CATEGORIES as readonly string[]).includes(category);
}

/** A stored menu key points at a PDF (rendered as a link, not an inline image). */
export function isMenuPdf(key: string): boolean {
  return key.toLowerCase().endsWith(".pdf");
}

/**
 * Validate newly uploaded menu files against the per-site cap, type and size.
 * Pure: the caller checks the category. Returns the files unchanged when fine.
 */
export function checkMenu<F extends { type: string; size: number }>(files: F[], existing: number): string | null {
  if (!files.length) return null;
  if (existing + files.length > MAX_MENU) return `Up to ${MAX_MENU} menu files in total.`;
  for (const f of files) {
    if (!MENU_TYPES.includes(f.type)) return "A menu must be a PDF or a JPG, PNG or WebP image.";
    if (f.size > MAX_MENU_BYTES) return `Each menu file must be under ${Math.round(MAX_MENU_BYTES / 1024 / 1024)} MB.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Class schedule (fitness & yoga): one uploaded timetable, image or PDF.

/** Categories that get a "Class schedule" section. */
export const SCHEDULE_CATEGORIES: readonly CategoryKey[] = ["fitness"];

export function scheduleAllowed(category: string): boolean {
  return (SCHEDULE_CATEGORIES as readonly string[]).includes(category);
}

// ---------------------------------------------------------------------------
// Insurance accepted (dentist, medical clinic).

/** Categories that get an "Insurance accepted" section. */
export const INSURANCE_CATEGORIES: readonly CategoryKey[] = ["dentist", "clinic"];

export function insuranceAllowed(category: string): boolean {
  return (INSURANCE_CATEGORIES as readonly string[]).includes(category);
}

// ---------------------------------------------------------------------------
// Meet the team (people-facing businesses).

export const MAX_TEAM = 12;
const MAX_TEAM_NAME = 60;
const MAX_TEAM_ROLE = 80;

/** Categories where a "Meet the team" section fits. */
export const TEAM_CATEGORIES: readonly CategoryKey[] = ["salon", "barber", "spa", "dentist", "clinic", "fitness", "realestate", "petcare"];

export function teamAllowed(category: string): boolean {
  return (TEAM_CATEGORIES as readonly string[]).includes(category);
}

/** Team members, one per line: "Name | Role" (role optional). Name required. */
export function parseTeam(raw: string): TeamMember[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_TEAM)
    .map((line) => {
      const [name, ...rest] = line.split("|").map((p) => p.trim());
      return { name: name ?? "", role: rest.join(" ").trim() };
    })
    .filter((m) => m.name);
}

export function teamToText(team: TeamMember[]): string {
  return team.map((m) => [m.name, m.role].filter(Boolean).join(" | ")).join("\n");
}

/** Validate the single uploaded schedule file (same types/size as a menu). */
export function checkScheduleFile(file: { type: string; size: number } | null): string | null {
  if (!file) return null;
  if (!MENU_TYPES.includes(file.type)) return "A schedule must be a PDF or a JPG, PNG or WebP image.";
  if (file.size > MAX_MENU_BYTES) return `The schedule must be under ${Math.round(MAX_MENU_BYTES / 1024 / 1024)} MB.`;
  return null;
}

type PhotoLike = { type: string; size: number };

/**
 * New pairs from the upload slots. A pair counts only with both halves; half a
 * pair is an error. Pure: the caller checks the category and the attestation.
 */
export function pickBeforeAfter<F extends PhotoLike>(
  slots: Partial<Record<BeforeAfterField, F>>,
  opts: { existing: number; types: string[]; maxBytes: number },
): { ok: true; pairs: [F, F][] } | { ok: false; error: string } {
  const pairs: [F, F][] = [];
  for (const [b, a] of BEFORE_AFTER_FIELDS) {
    const before = slots[b];
    const after = slots[a];
    if (!before && !after) continue;
    if (!before || !after) return { ok: false, error: "Add both a before and an after photo for each pair." };
    pairs.push([before, after]);
  }
  if (opts.existing + pairs.length > MAX_BEFORE_AFTER) return { ok: false, error: `Up to ${MAX_BEFORE_AFTER} before & after pairs in total.` };
  for (const f of pairs.flat()) {
    if (!opts.types.includes(f.type)) return { ok: false, error: `Before & after photos must be JPG, PNG${opts.types.includes("image/heic") ? ", WebP or HEIC" : " or WebP"} images.` };
    if (f.size > opts.maxBytes) return { ok: false, error: `Each before & after photo must be under ${Math.round(opts.maxBytes / 1024 / 1024)} MB.` };
  }
  return { ok: true, pairs };
}

/** Every R2 key this site's own host may serve (and removal must delete). */
export function siteFileKeys(site: Pick<Site, "photos" | "video" | "beforeAfter" | "menu" | "schedule">): string[] {
  return [...site.photos, ...(site.video ? [site.video] : []), ...(site.beforeAfter ?? []).flatMap((p) => [p.before, p.after]), ...(site.menu ?? []), ...(site.schedule ? [site.schedule] : [])];
}

const LIMITS = {
  businessName: 80,
  tagline: 120,
  about: 1200,
  phone: 24,
  email: 120,
  address: 160,
  city: 60,
  serviceArea: 160,
  hours: 400,
  offer: 160,
  insurance: 400,
  serviceName: 60,
  servicePrice: 24,
  testimonialName: 60,
  testimonialQuote: 300,
} as const;

/** Links in free text: scheme, www., or a bare domain with a path. */
const LINK_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|info|biz|xyz|site|page|link|ly|me|app)\b)/i;

export type FieldErrors = Record<string, string>;

/** Length and no-links rule for one free-text field; null when fine. */
function fieldProblem(k: keyof typeof LIMITS, v: string): string | null {
  if (v.length > LIMITS[k]) return `Keep it under ${LIMITS[k]} characters.`;
  if (v && LINK_PATTERN.test(v) && k !== "email") return "Links aren't allowed here.";
  return null;
}

export type OfferPayment = "advault" | "credit";
export type InternalOffer = { offer: string; payment: OfferPayment; ref: string };

/**
 * Body of POST /api/internal/sites/<slug>/offer (AdVault's offer combo). The
 * offer gets exactly the edit form's rules (length, no links); it must be
 * non-empty, since the combo puts an offer ON the site. `ref` is AdVault's
 * purchase id, the idempotency key.
 */
export function parseInternalOffer(body: unknown): { ok: true; value: InternalOffer } | { ok: false; error: string } {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const offer = text(b.offer);
  if (!offer) return { ok: false, error: "offer: Required." };
  const problem = fieldProblem("offer", offer);
  if (problem) return { ok: false, error: `offer: ${problem}` };
  if (b.payment !== "advault" && b.payment !== "credit") return { ok: false, error: "payment: Must be advault or credit." };
  const ref = typeof b.ref === "string" ? b.ref.trim() : "";
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(ref)) return { ok: false, error: "ref: 1-100 letters, digits, - or _." };
  return { ok: true, value: { offer, payment: b.payment, ref } };
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim() : "";
}

/**
 * "Lawn mowing - $35" / "Spring cleanup — from $149" / "Hedge trimming".
 * One service per line; the price is whatever follows the last dash.
 */
export function parseServices(raw: string): Service[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SERVICES)
    .map((line) => {
      const m = line.match(/^(.*?)\s+[-–—:]\s+(.+)$/);
      return m ? { name: m[1]!.trim(), price: m[2]!.trim() } : { name: line, price: null };
    });
}

export function servicesToText(services: Service[]): string {
  return services.map((s) => (s.price ? `${s.name} - ${s.price}` : s.name)).join("\n");
}

/**
 * One testimonial per line, "Name — what they said". A line with no separator
 * is taken as an unattributed quote. Caps at MAX_TESTIMONIALS.
 */
export function parseTestimonials(raw: string): Testimonial[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_TESTIMONIALS)
    .map((line) => {
      const m = line.match(/^(.*?)\s+[-–—:]\s+(.+)$/);
      return m ? { name: m[1]!.trim(), quote: m[2]!.trim() } : { name: "", quote: line };
    });
}

export function testimonialsToText(testimonials: Testimonial[]): string {
  return testimonials.map((t) => (t.name ? `${t.name} — ${t.quote}` : t.quote)).join("\n");
}

/**
 * Validate a visitor's review submission (the public "Leave a review" form).
 * Facts only: no links, length-capped, 1-5 whole-star rating. The caller does
 * the rate-limiting and honeypot; this just shapes and checks the content.
 */
export function parseReviewSubmission(
  fields: Record<string, unknown>,
): { ok: true; value: { name: string; rating: number; text: string } } | { ok: false; error: string } {
  const name = text(fields.name);
  const textBody = text(fields.text);
  const rating = Number(text(fields.rating));
  if (!name) return { ok: false, error: "Add your name." };
  if (name.length > MAX_REVIEW_NAME) return { ok: false, error: `Keep your name under ${MAX_REVIEW_NAME} characters.` };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Pick a rating from 1 to 5 stars." };
  if (!textBody) return { ok: false, error: "Write a short review." };
  if (textBody.length > MAX_REVIEW_TEXT) return { ok: false, error: `Keep your review under ${MAX_REVIEW_TEXT} characters.` };
  if (LINK_PATTERN.test(name) || LINK_PATTERN.test(textBody)) return { ok: false, error: "Links aren't allowed." };
  return { ok: true, value: { name, rating, text: textBody } };
}

/** Count and (one-decimal) average rating of the approved reviews. */
export function reviewStats(reviews: Review[]): { count: number; average: number } {
  if (reviews.length === 0) return { count: 0, average: 0 };
  const sum = reviews.reduce((n, r) => n + r.rating, 0);
  return { count: reviews.length, average: Math.round((sum / reviews.length) * 10) / 10 };
}

/**
 * Extra locations, one per line: "Name | Address | Phone". The name is
 * optional ("Address | Phone" works); lines without both an address and a
 * phone are dropped. Caps at MAX_LOCATIONS.
 */
export function parseLocations(raw: string): Location[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_LOCATIONS)
    .map((line) => {
      const parts = line.split("|").map((p) => p.trim());
      if (parts.length >= 3) return { name: parts[0]!, address: parts[1]!, phone: parts.slice(2).join(" ").trim() };
      if (parts.length === 2) return { name: "", address: parts[0]!, phone: parts[1]! };
      return { name: "", address: parts[0] ?? "", phone: "" };
    })
    .filter((l) => l.address && l.phone);
}

export function locationsToText(locations: Location[]): string {
  return locations.map((l) => [l.name, l.address, l.phone].filter(Boolean).join(" | ")).join("\n");
}

/** Validate form fields into SiteContent, or field-level errors. */
export function parseContent(
  fields: Record<string, unknown>,
): { ok: true; value: SiteContent } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const get = (k: string) => text(fields[k]);

  const businessName = get("businessName");
  const category = get("category") as CategoryKey;
  const tagline = get("tagline");
  const about = get("about");
  const phone = get("phone");
  const email = get("email");
  const address = get("address");
  const city = get("city");
  const serviceArea = get("serviceArea");
  const hours = get("hours");
  const offer = get("offer");
  const insurance = get("insurance");
  const services = parseServices(get("services"));
  const testimonials = parseTestimonials(get("testimonials"));
  const locations = parseLocations(get("locations"));
  const team = parseTeam(get("team"));

  const required: [string, string][] = [
    ["businessName", businessName],
    ["phone", phone],
  ];
  for (const [k, v] of required) if (!v) errors[k] = "Required.";
  // Town or city locates the business; a street address does the same job, so
  // it's only required when no address is given.
  if (!city && !address) errors.city = "Add a town or city, or a street address.";
  if (!(category in CATEGORIES)) errors.category = "Pick a business type.";

  const lengths: [keyof typeof LIMITS, string][] = [
    ["businessName", businessName],
    ["tagline", tagline],
    ["about", about],
    ["phone", phone],
    ["email", email],
    ["address", address],
    ["city", city],
    ["serviceArea", serviceArea],
    ["hours", hours],
    ["offer", offer],
    ["insurance", insurance],
  ];
  for (const [k, v] of lengths) {
    const problem = fieldProblem(k, v);
    if (problem) errors[k] = problem;
  }
  for (const s of services) {
    if (s.name.length > LIMITS.serviceName || (s.price?.length ?? 0) > LIMITS.servicePrice) {
      errors.services = `Keep each service under ${LIMITS.serviceName} characters and each price under ${LIMITS.servicePrice}.`;
    } else if (LINK_PATTERN.test(s.name) || (s.price && LINK_PATTERN.test(s.price))) {
      errors.services = "Links aren't allowed here.";
    }
  }
  for (const t of testimonials) {
    if (t.name.length > LIMITS.testimonialName || t.quote.length > LIMITS.testimonialQuote) {
      errors.testimonials = `Keep each name under ${LIMITS.testimonialName} and each quote under ${LIMITS.testimonialQuote} characters.`;
    } else if (LINK_PATTERN.test(t.name) || LINK_PATTERN.test(t.quote)) {
      errors.testimonials = "Links aren't allowed here.";
    }
  }
  for (const m of team) {
    if (m.name.length > MAX_TEAM_NAME || m.role.length > MAX_TEAM_ROLE) {
      errors.team = `Keep each name under ${MAX_TEAM_NAME} and each role under ${MAX_TEAM_ROLE} characters.`;
    } else if (LINK_PATTERN.test(m.name) || LINK_PATTERN.test(m.role)) {
      errors.team = "Links aren't allowed here.";
    }
  }
  for (const loc of locations) {
    const d = loc.phone.replace(/\D/g, "");
    if (loc.name.length > MAX_LOCATION_NAME || loc.address.length > MAX_LOCATION_ADDRESS) {
      errors.locations = `Keep each location's name under ${MAX_LOCATION_NAME} and address under ${MAX_LOCATION_ADDRESS} characters.`;
    } else if (d.length < 7 || d.length > 15 || /[^\d\s()+.-]/.test(loc.phone)) {
      errors.locations = "Give each location a valid phone, like (201) 555-0100.";
    } else if (LINK_PATTERN.test(loc.name) || LINK_PATTERN.test(loc.address)) {
      errors.locations = "Links aren't allowed here.";
    }
  }

  const digits = phone.replace(/\D/g, "");
  if (phone && (digits.length < 7 || digits.length > 15 || /[^\d\s()+.-]/.test(phone))) {
    errors.phone = "Enter a phone number, like (201) 555-0100.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      businessName,
      category,
      tagline,
      about,
      phone,
      email: email || null,
      address: address || null,
      city,
      serviceArea: serviceArea || null,
      hours: hours || null,
      services,
      testimonials,
      locations,
      offer: offer || null,
      template: asTemplate(get("template")),
      heroPhoto: get("heroPhoto") !== "no",
      insurance: insurance || null,
      team,
    },
  };
}

/** A policy override can be long (a full page of text), but not unbounded. */
export const MAX_POLICY_CHARS = 20000;
const POLICY_FIELD_KINDS: PolicyKind[] = ["privacy", "accessibility", "cookies", "terms"];

/**
 * Read the four policy-page textareas (`policy_<kind>`) from the edit form.
 * The owner either leaves the generated text as-is or edits it; `oldDefaults`
 * is the exact default text that was prefilled (built from the pre-save site),
 * so a submission equal to it — or empty — means "unchanged, keep using the
 * default" and stores nothing. Only genuine edits are stored as overrides, so
 * default pages keep tracking the business's details and template improvements.
 * Policy text may legitimately name the site's own URL, so the no-links rule is
 * not applied here; the renderer escapes everything, so it can't become a link.
 */
export function parsePolicies(
  fields: Record<string, unknown>,
  oldDefaults: Record<PolicyKind, string>,
): { value: Partial<Record<PolicyKind, string>>; errors: FieldErrors } {
  const value: Partial<Record<PolicyKind, string>> = {};
  const errors: FieldErrors = {};
  for (const kind of POLICY_FIELD_KINDS) {
    const submitted = text(fields[`policy_${kind}`]);
    if (!submitted || submitted === text(oldDefaults[kind])) continue;
    if (submitted.length > MAX_POLICY_CHARS) {
      errors[`policy_${kind}`] = `Keep this page under ${MAX_POLICY_CHARS.toLocaleString()} characters.`;
      continue;
    }
    value[kind] = submitted;
  }
  return { value, errors };
}

/** Headline when the business left the tagline blank. Facts only. */
export function headline(site: SiteContent): string {
  if (site.tagline) return site.tagline;
  const label = CATEGORIES[site.category].label.toLowerCase();
  if (site.category === "other") return site.city ? `Serving ${site.city}` : "";
  return site.city ? `${capitalize(label)} in ${site.city}` : capitalize(label);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
