// A site's address: <slug>.3pandasite.com. Pure rules, no KV.
//
// The business picks it (with a good default filled in), because it goes on
// their ads, cards and van. Two things are refused beyond the DNS-label
// basics: our own service names, and big brands. "paypal-login.3pandasite.com"
// is the textbook phishing hostname, and a free site builder that hands out
// such names becomes the place phishers go.

import { CATEGORIES, type CategoryKey } from "./site.js";
import { slugify } from "./util.js";

export const MIN_LEN = 3;
export const MAX_LEN = 40;
export const MAX_RENAMES = 3;

const RESERVED = new Set([
  "www", "api", "admin", "app", "apps", "mail", "email", "smtp", "imap", "pop", "ftp", "new", "edit", "help",
  "support", "s", "p", "static", "assets", "cdn", "img", "images", "media", "blog", "status", "docs", "dev",
  "test", "staging", "login", "signin", "signup", "account", "accounts", "billing", "pay", "payment",
  "payments", "secure", "security", "verify", "verification", "wallet", "bank", "sitevault", "advault",
  "3pandalabs", "3panda", "pandalabs", "official", "root", "null", "undefined",
]);

// Matched as a substring for longer names (hard to hit by accident), as a
// whole hyphen-separated word for short ones ("ups" must not block "pups").
const BRANDS_SUBSTRING = [
  "google", "gmail", "youtube", "paypal", "amazon", "microsoft", "outlook", "office365", "facebook",
  "instagram", "whatsapp", "netflix", "icloud", "wellsfargo", "bankofamerica", "citibank", "capitalone",
  "americanexpress", "venmo", "zelle", "cashapp", "coinbase", "binance", "metamask", "shopify", "walmart",
  "costco", "fedex", "medicare", "socialsecurity", "linkedin", "twitter", "tiktok", "snapchat", "spotify",
  "dropbox", "docusign", "quickbooks", "turbotax", "verizon", "tmobile", "comcast", "xfinity", "cloudflare",
  "godaddy",
];
// Whole words only: each is also part of ordinary words ("first", "purchase",
// "pineapple", "pinstripe"), so a substring match would refuse honest names.
const BRANDS_WORD = ["ups", "att", "hsbc", "citi", "boa", "meta", "irs", "usps", "dhl", "amex", "chase", "apple", "stripe", "adobe", "ebay", "intuit", "target"];

/** Why an address can't be used, or null when it's fine (availability aside). */
export function addressProblem(slug: string): string | null {
  if (slug.length < MIN_LEN) return `Use at least ${MIN_LEN} characters.`;
  if (slug.length > MAX_LEN) return `Use at most ${MAX_LEN} characters.`;
  if (!/^[a-z0-9-]+$/.test(slug)) return "Use only lowercase letters, numbers and hyphens.";
  if (slug.startsWith("-") || slug.endsWith("-")) return "It can't start or end with a hyphen.";
  if (slug.includes("--")) return "Use single hyphens only.";
  if (RESERVED.has(slug)) return "That address is reserved.";
  const words = slug.split("-");
  if (BRANDS_WORD.some((b) => words.includes(b)) || BRANDS_SUBSTRING.some((b) => slug.replace(/-/g, "").includes(b))) {
    return "That address includes another company's name. Please choose a different one.";
  }
  return null;
}

/** Normalise what someone typed into an address: "Bella's Hair!" -> "bellas-hair". */
export function normaliseAddress(typed: string): string {
  return slugify(typed.replace(/\.3pandasite\.com$/i, "").replace(/^https?:\/\//i, ""));
}

const CATEGORY_WORD: Partial<Record<CategoryKey, string>> = {
  landscaping: "landscaping",
  cleaning: "cleaning",
  plumbing: "plumbing",
  electrical: "electric",
  hvac: "hvac",
  handyman: "handyman",
  salon: "salon",
  barber: "barber",
  spa: "spa",
  restaurant: "kitchen",
  bakery: "bakery",
  dentist: "dental",
  clinic: "clinic",
  fitness: "fitness",
  auto: "auto",
  realestate: "realty",
  petcare: "pets",
};

/** Default addresses to try, shortest first: name, name-type, name-town. */
export function suggestAddresses(businessName: string, category: string, city: string): string[] {
  const name = slugify(businessName);
  const word = CATEGORY_WORD[category as CategoryKey];
  const town = slugify(city.split(",")[0] ?? "");
  const out = [name];
  if (word && !name.includes(word)) out.push(slugify(name, word));
  if (town) out.push(slugify(name, town));
  if (word && town) out.push(slugify(name, word, town));
  return [...new Set(out)].filter((s) => s && addressProblem(s) === null);
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES);
