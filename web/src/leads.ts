// Leads, bookings and review requests (2026-11-27). Pure rules only: no
// Worker APIs, so the tests run in plain Node. The routes are in index.ts, the
// HTML in leads-pages.ts, the AdVault calls in leads-api.ts.
//
// SiteVault stores NONE of the lead itself: a quote request, call-back request
// or booking is sent straight to AdVault (`POST /internal/sitevault/leads`),
// which keeps it and emails the owner. Here we keep only the owner's settings
// on the site record (`site.booking`, `site.reviewLink`, `site.placeId`,
// `site.googleRating`) and the customer's photos (R2 `leads/<slug>/`).

import { emailProblem, normaliseEmail } from "./accounts.js";
import type { Site } from "./site.js";

export type LeadKind = "quote" | "callback" | "booking";
export const LEAD_KINDS: readonly LeadKind[] = ["quote", "callback", "booking"];

/**
 * THE plan gate for quotes, call-backs, bookings and review requests: every
 * published site has them for now (Basic, Pro and AdVault-made). Pricing is
 * Anil's call; change it HERE only (every route, page and editor section asks
 * this one function).
 */
export function leadFeaturesOn(_site: Pick<Site, "source" | "billing">): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Booking settings

export type BookingService = { name: string; durationMin: number; price: string | null };
/** "HH:MM" 24-hour, start < end, same day. */
export type TimeWindow = { start: string; end: string };
export type BookingSettings = {
  on: boolean;
  services: BookingService[];
  /** Index 0 = Sunday ... 6 = Saturday (JS getUTCDay), each day's open windows. */
  weekly: TimeWindow[][];
  /** IANA zone, one of US_TIMEZONES. */
  timezone: string;
  /** Earliest booking: this many hours from now. */
  leadHours: number;
  /** Latest booking: this many days ahead. */
  daysAhead: number;
};

export const MAX_BOOKING_SERVICES = 6;
export const WINDOWS_PER_DAY = 2;
export const LEAD_HOUR_CHOICES = [0, 1, 2, 4, 12, 24, 48];
export const DAYS_AHEAD_CHOICES = [7, 14, 30, 60, 90];
/** Editor order: Monday first. Values are getUTCDay indexes. */
export const WEEKDAYS: { day: number; label: string; short: string }[] = [
  { day: 1, label: "Monday", short: "Mon" },
  { day: 2, label: "Tuesday", short: "Tue" },
  { day: 3, label: "Wednesday", short: "Wed" },
  { day: 4, label: "Thursday", short: "Thu" },
  { day: 5, label: "Friday", short: "Fri" },
  { day: 6, label: "Saturday", short: "Sat" },
  { day: 0, label: "Sunday", short: "Sun" },
];

export const US_TIMEZONES: { id: string; label: string }[] = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Phoenix", label: "Arizona (no daylight saving)" },
  { id: "America/Los_Angeles", label: "Pacific" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];
const ZONE_IDS = new Set(US_TIMEZONES.map((z) => z.id));

// Main zone per state (a few states span two; the owner can change it).
const STATE_ZONES: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Denver", IL: "America/Chicago", IN: "America/New_York",
  IA: "America/Chicago", KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York",
  MD: "America/New_York", MA: "America/New_York", MI: "America/New_York", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York", NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago",
  OH: "America/New_York", OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VT: "America/New_York", VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago",
  WY: "America/Denver", PR: "America/New_York",
};

/** The site's zone from its location ("Austin, TX", "... NJ 07094"), else Eastern. */
export function timezoneFor(site: Pick<Site, "city" | "address">): string {
  for (const text of [site.city, site.address ?? ""]) {
    const m = text.toUpperCase().match(/(?:^|[\s,])([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
    const zone = m ? STATE_ZONES[m[1]!] : undefined;
    if (zone) return zone;
  }
  return "America/New_York";
}

const NINE_TO_FIVE: TimeWindow[] = [{ start: "09:00", end: "17:00" }];
/** Off until the owner turns it on; Mon-Fri 9-5 to start from. */
export function defaultBooking(site: Pick<Site, "city" | "address">): BookingSettings {
  return {
    on: false,
    services: [],
    weekly: [[], NINE_TO_FIVE, NINE_TO_FIVE, NINE_TO_FIVE, NINE_TO_FIVE, NINE_TO_FIVE, []],
    timezone: timezoneFor(site),
    leadHours: 2,
    daysAhead: 30,
  };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type SettingsErrors = Record<string, string>;

/**
 * The editor's "Bookings & reviews" form -> settings, or field errors.
 * Fields: bookingOn=yes; svcName{i}/svcMin{i}/svcPrice{i} (i < 6);
 * day{d}=yes, day{d}s{w}/day{d}e{w} (d = getUTCDay, w < 2); timezone;
 * leadHours; daysAhead; reviewLink (a Google link or a Place ID);
 * googleRating, googleCount.
 */
export function parseLeadSettings(
  fields: Record<string, string>,
): { ok: true; booking: BookingSettings; reviewLink: string | null; placeId: string | null; googleRating: GoogleRating | null } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  const get = (k: string) => (fields[k] ?? "").trim();
  const services: BookingService[] = [];
  for (let i = 0; i < MAX_BOOKING_SERVICES; i++) {
    const name = get(`svcName${i}`).slice(0, 80);
    const minRaw = get(`svcMin${i}`);
    const price = get(`svcPrice${i}`).slice(0, 40);
    if (!name && !minRaw && !price) continue;
    const min = Number(minRaw);
    if (!name) errors.services = "Give each service a name.";
    else if (!Number.isInteger(min) || min < 5 || min > 480) errors.services = "Each service needs a length between 5 and 480 minutes.";
    else if (/https?:|www\./i.test(name + price)) errors.services = "Links aren't allowed here.";
    else services.push({ name, durationMin: min, price: price || null });
  }
  const weekly: TimeWindow[][] = [[], [], [], [], [], [], []];
  for (let d = 0; d < 7; d++) {
    if (get(`day${d}`) !== "yes") continue;
    for (let w = 0; w < WINDOWS_PER_DAY; w++) {
      const start = get(`day${d}s${w}`);
      const end = get(`day${d}e${w}`);
      if (!start && !end) continue;
      if (!TIME_RE.test(start) || !TIME_RE.test(end) || minutesOf(end) <= minutesOf(start)) {
        errors.weekly = "Check your hours: each open day needs a start time before its end time.";
        continue;
      }
      weekly[d]!.push({ start, end });
    }
    const [a, b] = weekly[d]!;
    if (a && b && minutesOf(b.start) < minutesOf(a.end) && minutesOf(a.start) < minutesOf(b.end)) errors.weekly = "The two time ranges on one day can't overlap.";
  }
  const timezone = ZONE_IDS.has(get("timezone")) ? get("timezone") : "America/New_York";
  const leadHours = LEAD_HOUR_CHOICES.includes(Number(get("leadHours"))) ? Number(get("leadHours")) : 2;
  const daysAhead = DAYS_AHEAD_CHOICES.includes(Number(get("daysAhead"))) ? Number(get("daysAhead")) : 30;
  const on = get("bookingOn") === "yes";
  if (on && !services.length && !errors.services) errors.services = "Add at least one service people can book.";
  if (on && weekly.every((w) => !w.length) && !errors.weekly) errors.weekly = "Tick at least one day you take bookings.";

  const link = parseReviewLink(get("reviewLink"));
  if (!link.ok) errors.reviewLink = link.error;
  let googleRating: GoogleRating | null = null;
  const r = get("googleRating");
  const c = get("googleCount");
  if (r) {
    const rating = Number(r);
    const count = c ? Number(c.replace(/,/g, "")) : null;
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) errors.googleRating = "Your Google rating is a number from 1 to 5, like 4.8.";
    else if (count !== null && (!Number.isInteger(count) || count < 0 || count > 1_000_000)) errors.googleRating = "The number of reviews should be a whole number.";
    else googleRating = { rating: Math.round(rating * 10) / 10, count };
  } else if (c) errors.googleRating = "Add your rating too, or leave both empty.";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    booking: { on, services, weekly, timezone, leadHours, daysAhead },
    reviewLink: link.ok ? link.url : null,
    placeId: link.ok ? link.placeId : null,
    googleRating,
  };
}

/** Bookings are live on this site (turned on, with something to book). */
export function bookingOn(site: Pick<Site, "booking" | "source" | "billing">): boolean {
  const b = site.booking;
  return Boolean(leadFeaturesOn(site) && b?.on && b.services.length && b.weekly.some((w) => w.length));
}

// ---------------------------------------------------------------------------
// Google review link

export type GoogleRating = { rating: number; count: number | null };

const PLACE_ID_RE = /^[A-Za-z0-9_-]{16,256}$/;
export const validPlaceId = (s: unknown): boolean => typeof s === "string" && PLACE_ID_RE.test(s);
export const writeReviewUrl = (placeId: string) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

// Only Google's own review hosts: the /review page must never become a
// redirect to anywhere else (phishing), same rule as no links in free text.
const REVIEW_HOSTS = new Set(["search.google.com", "www.google.com", "google.com", "maps.google.com", "g.page", "maps.app.goo.gl", "goo.gl", "g.co"]);

/** A pasted Google review link or Place ID -> the link to send customers to. "" = none. */
export function parseReviewLink(raw: string): { ok: true; url: string | null; placeId: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, url: null, placeId: null };
  if (validPlaceId(s)) return { ok: true, url: writeReviewUrl(s), placeId: s };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, error: "Paste your Google review link (it starts with https://) or your Google Place ID." };
  }
  if (u.protocol !== "https:" || u.username || u.password || !REVIEW_HOSTS.has(u.hostname.toLowerCase()) || s.length > 500) {
    return { ok: false, error: "That doesn't look like a Google review link. Use the \"Ask for reviews\" link from your Google Business Profile." };
  }
  const pid = u.searchParams.get("placeid");
  return { ok: true, url: u.toString(), placeId: pid && validPlaceId(pid) ? pid : null };
}

/** Where /review sends customers: the owner's link, else one built from the Place ID AdVault sent. */
export function reviewUrlFor(site: Pick<Site, "reviewLink" | "placeId" | "source" | "billing">): string | null {
  if (!leadFeaturesOn(site)) return null;
  if (site.reviewLink) return site.reviewLink;
  return validPlaceId(site.placeId) ? writeReviewUrl(site.placeId as string) : null;
}

// ---------------------------------------------------------------------------
// Time zones (Intl only; Workers ship full ICU)

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsIn(tz: string, at: Date): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year!, m: p.month!, d: p.day!, hh: p.hour! % 24, mm: p.minute!, ss: p.second! };
}

/** Minutes the zone is ahead of UTC at that instant (New York in winter = -300). */
export function offsetMinutes(tz: string, at: Date): number {
  const p = partsIn(tz, at);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** A wall-clock time in `tz` -> the instant, or null when it doesn't exist (the spring-forward gap). */
export function zonedToUtc(tz: string, y: number, m: number, d: number, minutes: number): Date | null {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - offsetMinutes(tz, new Date(guess)) * 60000;
  const off2 = offsetMinutes(tz, new Date(t));
  t = guess - off2 * 60000;
  const p = partsIn(tz, new Date(t));
  if (p.y !== y || p.m !== m || p.d !== d || p.hh * 60 + p.mm !== minutes) return null;
  return new Date(t);
}

/** "2026-12-01T09:30:00-05:00": the instant as wall-clock time in `tz` with its offset. */
export function isoInZone(tz: string, at: Date): string {
  const p = partsIn(tz, at);
  const off = offsetMinutes(tz, at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** "9:30 am" in `tz`. */
export function timeLabel(tz: string, at: Date): string {
  const p = partsIn(tz, at);
  const h = p.hh % 12 || 12;
  return `${h}:${String(p.mm).padStart(2, "0")} ${p.hh < 12 ? "am" : "pm"}`;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-12-01" -> "Tue, Dec 1" (long: "Tuesday, Dec 1"). */
export function dateLabel(date: string, long = false): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${(long ? DAY_LONG : DAY_SHORT)[wd]}, ${MON_SHORT[m - 1]} ${d}`;
}

/** A booking's start as the owner reads it: "Tue, Dec 1, 9:30 am". */
export function bookingWhen(startIso: string, tz: string): string {
  const at = new Date(startIso);
  if (Number.isNaN(at.getTime())) return startIso;
  const zone = ZONE_IDS.has(tz) ? tz : "America/New_York";
  const p = partsIn(zone, at);
  const date = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return `${dateLabel(date)}, ${timeLabel(zone, at)}`;
}

// ---------------------------------------------------------------------------
// Free slots

export type Busy = { start: string; end: string };
export type Slot = { start: string; label: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** The local dates bookings may fall on: today (in the site's zone) .. today + daysAhead - 1. */
export function bookingDates(b: BookingSettings, now: Date): string[] {
  const p = partsIn(b.timezone, now);
  const out: string[] = [];
  for (let i = 0; i < b.daysAhead; i++) out.push(new Date(Date.UTC(p.y, p.m - 1, p.d + i)).toISOString().slice(0, 10));
  return out;
}

/** The window [from, to) to ask AdVault for busy times. */
export function busyRange(b: BookingSettings, now: Date): { from: string; to: string } {
  return { from: now.toISOString(), to: new Date(now.getTime() + (b.daysAhead + 1) * 86_400_000).toISOString() };
}

/**
 * Free starts for one service on one local date: inside an open window, the
 * whole service fits before the window closes, at least `leadHours` from now,
 * within `daysAhead`, and not overlapping a requested/confirmed booking.
 * Starts every 30 minutes (15 for services shorter than 30).
 */
export function freeSlots(b: BookingSettings, service: BookingService, date: string, now: Date, busy: Busy[], dates = bookingDates(b, now)): Slot[] {
  if (!validDate(date) || !dates.includes(date)) return [];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const step = service.durationMin < 30 ? 15 : 30;
  const earliest = now.getTime() + b.leadHours * 3_600_000;
  const busyMs = busy.map((x) => [Date.parse(x.start), Date.parse(x.end)] as const).filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e));
  const pad = (n: number) => String(n).padStart(2, "0");
  const out: Slot[] = [];
  for (const w of b.weekly[wd] ?? []) {
    const ws = minutesOf(w.start);
    const we = minutesOf(w.end);
    // One offset for the whole window (2 Intl lookups), unless daylight saving
    // changes inside it: then every start is checked on its own.
    const first = zonedToUtc(b.timezone, y, m, d, ws);
    const last = zonedToUtc(b.timezone, y, m, d, we);
    const off = first ? offsetMinutes(b.timezone, first) : null;
    const steady = first !== null && last !== null && off === offsetMinutes(b.timezone, last);
    for (let t = ws; t + service.durationMin <= we; t += step) {
      let s: number;
      let o: number;
      if (steady) {
        o = off!;
        s = Date.UTC(y, m - 1, d, 0, t) - o * 60000;
      } else {
        const at = zonedToUtc(b.timezone, y, m, d, t);
        if (!at) continue;
        s = at.getTime();
        o = offsetMinutes(b.timezone, at);
      }
      if (s < earliest) continue;
      const e = s + service.durationMin * 60000;
      if (busyMs.some(([bs, be]) => s < be && bs < e)) continue;
      const hh = Math.floor(t / 60);
      const mm = t % 60;
      const a = Math.abs(o);
      out.push({
        start: `${date}T${pad(hh)}:${pad(mm)}:00${o < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`,
        label: `${hh % 12 || 12}:${pad(mm)} ${hh < 12 ? "am" : "pm"}`,
      });
    }
  }
  return out;
}

/** Dates with at least one free slot for the service, in order. */
export function openDates(b: BookingSettings, service: BookingService, now: Date, busy: Busy[]): { date: string; label: string; slots: number }[] {
  const dates = bookingDates(b, now);
  return dates
    .map((date) => ({ date, label: dateLabel(date), slots: freeSlots(b, service, date, now, busy, dates).length }))
    .filter((x) => x.slots > 0);
}

// ---------------------------------------------------------------------------
// What a visitor sends

export type LeadSource = { referrerHost?: string; utmSource?: string; utmCampaign?: string };
export type LeadInput = { name: string; phone: string; email?: string; message?: string; bestTime?: string };

const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const cleanUtm = (v: string | null | undefined) => {
  const s = (v ?? "").trim().slice(0, 100);
  return /^[A-Za-z0-9 ._~+\-]+$/.test(s) ? s : undefined;
};
const cleanHost = (v: string | null | undefined) => {
  const s = (v ?? "").trim().toLowerCase();
  return s && HOST_RE.test(s) && s.includes(".") ? s : undefined;
};

/** Where a visitor came from, read on the server: the Referer's host (not our own) + utm_* on the page URL. */
export function sourceFromRequest(pageUrl: URL, referer: string | null): LeadSource {
  let referrerHost: string | undefined;
  try {
    const h = referer ? new URL(referer).hostname.toLowerCase() : "";
    if (h && h !== pageUrl.hostname.toLowerCase()) referrerHost = cleanHost(h);
  } catch {
    // no usable referrer
  }
  return compactSource({ referrerHost, utmSource: cleanUtm(pageUrl.searchParams.get("utm_source")), utmCampaign: cleanUtm(pageUrl.searchParams.get("utm_campaign")) });
}

/** The same, carried through the booking steps / forms as hidden fields src_ref, src_us, src_uc. */
export function sourceFromFields(f: Record<string, string | undefined>): LeadSource {
  return compactSource({ referrerHost: cleanHost(f.src_ref), utmSource: cleanUtm(f.src_us), utmCampaign: cleanUtm(f.src_uc) });
}

function compactSource(s: LeadSource): LeadSource {
  const out: LeadSource = {};
  if (s.referrerHost) out.referrerHost = s.referrerHost;
  if (s.utmSource) out.utmSource = s.utmSource;
  if (s.utmCampaign) out.utmCampaign = s.utmCampaign;
  return out;
}

export const sourceParams = (s: LeadSource): [string, string][] =>
  [
    ["src_ref", s.referrerHost],
    ["src_us", s.utmSource],
    ["src_uc", s.utmCampaign],
  ].filter((p): p is [string, string] => Boolean(p[1]));

/** The visitor's details: name + phone always, email for bookings (their confirmation goes there). */
export function parseLeadInput(kind: LeadKind, f: Record<string, string | undefined>): { ok: true; value: LeadInput } | { ok: false; errors: Record<string, string> } {
  const get = (k: string, max: number) => (f[k] ?? "").trim().slice(0, max);
  const errors: Record<string, string> = {};
  const name = get("name", 80);
  const phone = get("phone", 30);
  const emailRaw = get("email", 254);
  const message = get("message", 2000);
  const bestTime = get("bestTime", 80);
  if (!name) errors.name = "Please add your name.";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || /[^\d\s()+.\-]/.test(phone)) errors.phone = "Please add a phone number we can call.";
  const email = emailRaw ? normaliseEmail(emailRaw) : "";
  if (email && emailProblem(email)) errors.email = "That email doesn't look right.";
  if (kind === "booking" && !email) errors.email = "Please add your email so we can confirm your booking.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const value: LeadInput = { name, phone };
  if (email) value.email = email;
  if (message) value.message = message;
  if (bestTime && kind === "callback") value.bestTime = bestTime;
  return { ok: true, value };
}

export const MAX_LEAD_PHOTOS = 3;
export const MAX_LEAD_PHOTO_BYTES = 15 * 1024 * 1024;
export const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** The statuses an owner can set (AdVault's contract). */
export const LEAD_STATUSES = ["new", "contacted", "confirmed", "declined", "done"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
