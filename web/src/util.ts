// Small pure helpers. No Worker APIs here except Web Crypto, so the tests
// run in plain Node.

/** HTML-escape for text AND attribute values. Every user string goes through this. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "Bella's Hair & Nails" + "Secaucus" -> "bellas-hair-nails-secaucus". */
export function slugify(...parts: string[]): string {
  return parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** Digits only, keeping a leading +. "(201) 555-0100" -> "2015550100". */
export function phoneDigits(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

/** tel: target. US 10-digit numbers get +1 so they dial from any phone. */
export function telHref(phone: string): string {
  const d = phoneDigits(phone);
  if (d.startsWith("+")) return `tel:${d}`;
  if (d.length === 10) return `tel:+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `tel:+${d}`;
  return `tel:${d}`;
}

export function smsHref(phone: string): string {
  return telHref(phone).replace(/^tel:/, "sms:");
}

/** Google Maps search link: no embed, no iframe, no third-party cookies on the page. */
export function mapsHref(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Random URL-safe secret (the private edit key). */
export function randomKey(bytes = 24): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare for tokens and hashes. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** JSON for a <script type="application/ld+json"> block: no "</script>" breakout. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
