// Visit stats per site, in aggregate only (D1 `daily` table, one row per
// slug/day/source/country/city/device with counters). No cookies, no IP
// address, no user agent, no full referrer URL: just enough to tell a
// business "38 visits this week, mostly from YouTube, mostly on phones".
//
// The classification helpers are pure and unit-tested; the D1 helpers take
// the binding as an argument.

export type TapKind = "call" | "directions" | "offer";
export const TAP_KINDS: TapKind[] = ["call", "directions", "offer"];
export type Device = "mobile" | "tablet" | "desktop";

const SOURCES = ["youtube", "google", "facebook", "instagram", "whatsapp", "advault"] as const;
// Known platforms, plus "direct"/"other", plus an actual referring domain (a
// bare host like "bing.com" — never a path or query) for sites we don't tag.
export type StatSource = (typeof SOURCES)[number] | "direct" | "other" | (string & {});

/** Crawlers, link-preview fetchers (WhatsApp, Facebook, Slack...) and scripts are not visits. */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|facebot|whatsapp|telegram|discord|slack|skype|twitter|linkedin|embedly|pinterest|vkshare|quora link|headless|lighthouse|pagespeed|google-inspectiontool|adsbot|mediapartners|feedfetcher|curl|wget|python|go-http|java\/|okhttp|axios|node-fetch|undici|httpclient|monitor|uptime|scan/i;

export function isBot(ua: string | null): boolean {
  return !ua || BOT_UA.test(ua);
}

/** Browser speculative loads (prefetch/prerender) aren't visits until shown. */
export function isPrefetch(headers: Headers): boolean {
  const p = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-moz") ?? ""}`.toLowerCase();
  return p.includes("prefetch") || p.includes("prerender");
}

export function deviceOf(ua: string | null): Device {
  const u = ua ?? "";
  if (/ipad|tablet|kindle|silk\/|playbook/i.test(u) || (/android/i.test(u) && !/mobile/i.test(u))) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone|blackberry|opera mini/i.test(u)) return "mobile";
  return "desktop";
}

/** utm_source values as typed in ads and links, normalised. */
export function normaliseUtm(raw: string): StatSource {
  const v = raw.trim().toLowerCase();
  if (!v) return "direct";
  if (/^(youtube|yt|youtube_ads|youtube-ads|shorts)$/.test(v) || v.includes("youtube")) return "youtube";
  if (/^(google|adwords|gads|googleads|google_ads|google-ads)$/.test(v) || v.startsWith("google")) return "google";
  if (/^(facebook|fb|meta)$/.test(v) || v.includes("facebook")) return "facebook";
  if (/^(instagram|ig|insta)$/.test(v) || v.includes("instagram")) return "instagram";
  if (/^(whatsapp|wa)$/.test(v) || v.includes("whatsapp")) return "whatsapp";
  if (v.includes("advault")) return "advault";
  return "other";
}

/** Where a referring host is, by name. */
export function hostSource(host: string): StatSource {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)google\.[a-z.]+$/.test(h)) return "google";
  if (h === "youtu.be" || /(^|\.)youtube\.com$/.test(h)) return "youtube";
  if (/(^|\.)(facebook\.com|fb\.com|fb\.me)$/.test(h)) return "facebook";
  if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
  if (h === "wa.me" || /(^|\.)whatsapp\.(com|net)$/.test(h)) return "whatsapp";
  if (h === "advault.3pandalabs.com") return "advault";
  // An untagged referrer: keep the actual domain (host only, never the path) so
  // the owner sees which site linked to them. Fall back to "other" if it isn't a
  // plausible hostname.
  if (h.includes(".") && !h.includes("..") && !h.startsWith(".") && !h.endsWith(".") && /^[a-z0-9.-]{1,80}$/.test(h)) return h;
  return "other";
}

/**
 * A visit's source: utm_source on the page URL first, else the Referer's
 * host. A referrer from the site's own host is ignored (a reload or the name
 * link), which leaves "direct".
 */
export function classifySource(pageUrl: URL, referer: string | null, ownHost: string): StatSource {
  const utm = pageUrl.searchParams.get("utm_source");
  if (utm) return normaliseUtm(utm);
  if (!referer) return "direct";
  let host: string;
  try {
    host = new URL(referer).hostname;
  } catch {
    return "direct";
  }
  if (!host || host.toLowerCase() === ownHost.toLowerCase()) return "direct";
  return hostSource(host);
}

/** A tap's source: the utm_source of the page it happened on (Ping-From, then Referer), else direct. */
export function tapSource(pingFrom: string | null, referer: string | null): StatSource {
  for (const u of [pingFrom, referer]) {
    if (!u) continue;
    try {
      const utm = new URL(u).searchParams.get("utm_source");
      if (utm) return normaliseUtm(utm);
    } catch {
      // ignore
    }
  }
  return "direct";
}

export type Hit = { slug: string; day: string; source: StatSource; country: string; city: string; device: Device };

/** Rough location from Cloudflare's request.cf. City may be empty. */
export function hitFor(slug: string, source: StatSource, cf: { country?: unknown; city?: unknown } | undefined, ua: string | null, now: Date): Hit {
  const country = typeof cf?.country === "string" && /^[A-Z0-9]{2}$/.test(cf.country) ? cf.country : "";
  const city = typeof cf?.city === "string" ? cf.city.slice(0, 60) : "";
  return { slug, day: now.toISOString().slice(0, 10), source, country, city, device: deviceOf(ua) };
}

const COLUMNS = { view: "views", call: "calls", directions: "directions", offer: "offer_taps" } as const;
export type Counter = keyof typeof COLUMNS;

export async function recordHit(db: D1Database, hit: Hit, counter: Counter): Promise<void> {
  const col = COLUMNS[counter];
  await db
    .prepare(
      `INSERT INTO daily (slug, day, source, country, city, device, ${col}) VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT (slug, day, source, country, city, device) DO UPDATE SET ${col} = ${col} + 1`,
    )
    .bind(hit.slug, hit.day, hit.source, hit.country, hit.city, hit.device)
    .run();
}

export type SiteStats = {
  total: number;
  days: { day: string; views: number }[];
  sources: { source: string; views: number }[];
  places: { city: string; country: string; views: number }[];
  devices: { device: string; views: number }[];
  taps: { calls: number; directions: number; offer: number };
};

/** Last `days` days for a site and its old addresses. */
export async function readStats(db: D1Database, slugs: string[], now: Date, days = 30): Promise<SiteStats> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const marks = slugs.map(() => "?").join(", ");
  const where = `WHERE slug IN (${marks}) AND day >= ?`;
  const args = [...slugs, since];
  const q = (sql: string) => db.prepare(sql).bind(...args);
  const [tot, byDay, bySource, byPlace, byDevice] = await db.batch([
    q(`SELECT COALESCE(SUM(views),0) AS views, COALESCE(SUM(calls),0) AS calls, COALESCE(SUM(directions),0) AS directions, COALESCE(SUM(offer_taps),0) AS offer FROM daily ${where}`),
    q(`SELECT day, SUM(views) AS views FROM daily ${where} GROUP BY day HAVING SUM(views) > 0 ORDER BY day DESC`),
    q(`SELECT source, SUM(views) AS views FROM daily ${where} GROUP BY source HAVING SUM(views) > 0 ORDER BY views DESC LIMIT 8`),
    q(`SELECT city, country, SUM(views) AS views FROM daily ${where} GROUP BY city, country HAVING SUM(views) > 0 ORDER BY views DESC LIMIT 8`),
    q(`SELECT device, SUM(views) AS views FROM daily ${where} GROUP BY device HAVING SUM(views) > 0 ORDER BY views DESC`),
  ]);
  const rows = <T>(r: D1Result | undefined) => (r?.results ?? []) as T[];
  const t = rows<{ views: number; calls: number; directions: number; offer: number }>(tot)[0];
  return {
    total: Number(t?.views ?? 0),
    days: rows<{ day: string; views: number }>(byDay),
    sources: rows<{ source: string; views: number }>(bySource),
    places: rows<{ city: string; country: string; views: number }>(byPlace),
    devices: rows<{ device: string; views: number }>(byDevice),
    taps: { calls: Number(t?.calls ?? 0), directions: Number(t?.directions ?? 0), offer: Number(t?.offer ?? 0) },
  };
}
