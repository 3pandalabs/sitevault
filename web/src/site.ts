// What a site IS, and the rules for accepting one. Pure: no KV, no R2.
//
// The integrity rule, same as AdVault's ads: a site shows ONLY facts the
// business typed. Nothing is invented. And because these pages live on a
// 3PandaLabs hostname, free text may not contain links: a site is a business
// card, not a page that can send visitors elsewhere (that is how a free page
// builder becomes a phishing host).

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

export type Service = { name: string; price: string | null };

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
  offer: string | null;
};

export type Site = SiteContent & {
  slug: string;
  photos: string[];
  /** R2 key of the business's video ad (AdVault sites only). */
  video?: string | null;
  /** Earlier addresses, each a permanent redirect to this one. */
  aliases?: string[];
  /** How many times the address was changed (capped). */
  renames?: number;
  status: "live" | "removed";
  source: "web" | "advault";
  editKeyHash: string;
  createdAt: string;
  updatedAt: string;
};

export const MAX_PHOTOS = 8;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_SERVICES = 12;

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
  serviceName: 60,
  servicePrice: 24,
} as const;

/** Links in free text: scheme, www., or a bare domain with a path. */
const LINK_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|info|biz|xyz|site|page|link|ly|me|app)\b)/i;

export type FieldErrors = Record<string, string>;

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
  const services = parseServices(get("services"));

  const required: [string, string][] = [
    ["businessName", businessName],
    ["phone", phone],
    ["city", city],
  ];
  for (const [k, v] of required) if (!v) errors[k] = "Required.";
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
  ];
  for (const [k, v] of lengths) {
    if (v.length > LIMITS[k]) errors[k] = `Keep it under ${LIMITS[k]} characters.`;
    else if (v && LINK_PATTERN.test(v) && k !== "email") errors[k] = "Links aren't allowed here.";
  }
  for (const s of services) {
    if (s.name.length > LIMITS.serviceName || (s.price?.length ?? 0) > LIMITS.servicePrice) {
      errors.services = `Keep each service under ${LIMITS.serviceName} characters and each price under ${LIMITS.servicePrice}.`;
    } else if (LINK_PATTERN.test(s.name) || (s.price && LINK_PATTERN.test(s.price))) {
      errors.services = "Links aren't allowed here.";
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
      offer: offer || null,
    },
  };
}

/** Headline when the business left the tagline blank. Facts only. */
export function headline(site: SiteContent): string {
  if (site.tagline) return site.tagline;
  const label = CATEGORIES[site.category].label.toLowerCase();
  return site.category === "other" ? `Serving ${site.city}` : `${capitalize(label)} in ${site.city}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
