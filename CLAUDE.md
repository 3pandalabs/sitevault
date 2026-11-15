# SiteVault: notes for Claude

10th 3PandaLabs product (2026-11-15). Instant one-page websites for local
businesses that have none. Born from AdVault, where a website became optional
(AdVault PR #76) and launch needs a link. Idea record: 3pandalabs/ideas
`ideas/sitevault.md`. Open decisions and next work: `TODO.md`.

## Shape

- **One Cloudflare Worker, no server, no database** (`web/`). KV `SITES`
  holds `site:<slug>` JSON (metadata: status, source, createdAt), short-lived
  `rl:` rate-limit counters and `done:` handoffs. R2 `sitevault-photos` holds
  `sites/<slug>/<random>.<ext>` (random keys, so photos cache forever).
- Main site `sitevault.3pandalabs.com` (custom_domain route, one first label:
  see the org's Cloudflare two-label cert rule). Customer sites are served at
  `/s/<slug>` until the separate customer-site domain exists; then set
  `SITES_DOMAIN` and add the wildcard route. The code already routes
  `<slug>.<SITES_DOMAIN>`.
- **Customer sites must NOT live on 3pandalabs.com subdomains**: one abusive
  site would hurt the domain every org app uses, and two-label names aren't
  covered by free Universal SSL.

## Rules that matter

- **Facts only.** A site shows only what the business typed. No generated
  claims. If Claude copy help is added, the prompt must forbid invented facts.
- **No links in free text** (`LINK_PATTERN` in `site.ts`): a business card,
  not a redirect page, so SiteVault can't become a phishing host.
- **Escape everything** with `esc()`; JSON-LD via `jsonForScript()`. Strict CSP:
  customer sites run no JavaScript at all; builder pages use a per-response nonce.
- **Accessibility is required** (US ADA website suits): landmarks, headings,
  alt text, focus outlines, 44px targets, 4.5:1 contrast for every
  `CATEGORIES[*].brand` colour against white.
- **Privacy**: no cookies, analytics or trackers, on SiteVault or customer
  sites. Maps are a link, never an embed. Change the privacy page in the
  same PR as any change to what is stored.
- Edit access is a **secret edit key** (only its SHA-256 is stored), shown
  once on the done page. Removal deletes photos and keeps a `removed` record
  so the slug isn't reused.
- `/metrics` uses the shared org envelope (`app/collectedAt/uptimeSeconds/
  counts/traffic/process/database`); `traffic/process/database` are null for
  a Worker, same as MealMargin.

## Git

Branch, PR, merge; never `git add -A`. Commit identity per the org
convention (3pandalabs-admin noreply).
