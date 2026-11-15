-- Visit stats per site, aggregate only: no IP, no user agent, no full referrer.
-- One row per site/day/source/rough location/device type, with counters.
CREATE TABLE IF NOT EXISTS daily (
  slug TEXT NOT NULL,
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  source TEXT NOT NULL,       -- youtube|google|facebook|instagram|whatsapp|advault|direct|other
  country TEXT NOT NULL,      -- ISO 3166 alpha-2 from Cloudflare, '' if unknown
  city TEXT NOT NULL,         -- from Cloudflare, '' if unknown
  device TEXT NOT NULL,       -- mobile|tablet|desktop
  views INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  directions INTEGER NOT NULL DEFAULT 0,
  offer_taps INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day, source, country, city, device)
);
