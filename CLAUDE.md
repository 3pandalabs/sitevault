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
- **Customer sites: `<slug>.3pandasite.com`** (2026-11-15). Wildcard route `*.3pandasite.com/*` + a proxied `* AAAA 100::` DNS record (added by hand; wrangler can't). Photos/video are served from the site's own host. Apex and www redirect to the home page; old `/s/<slug>` links 301 to the subdomain.
- Main site `sitevault.3pandalabs.com` (custom_domain route, one first label:
  see the org's Cloudflare two-label cert rule). Customer sites are served at
  `/s/<slug>` until the separate customer-site domain exists; then set
  `SITES_DOMAIN` and add the wildcard route. The code already routes
  `<slug>.<SITES_DOMAIN>`.
- **Customer sites must NOT live on 3pandalabs.com subdomains**: one abusive
  site would hurt the domain every org app uses, and two-label names aren't
  covered by free Universal SSL.

## Look

SiteVault's OWN pages use the org app chrome (same as AdVault): dark zinc,
blurred blobs + dot grid, `Site**Vault**` wordmark with the "by 3PandaLabs"
tag, rounded-xl buttons, the canonical footer ("© 3PandaLabs LLC, USA." /
"All rights reserved.", from 3pandalabs/brand). Register: sky + violet.
Customer sites are deliberately different: light, the business's own,
coloured per category.

## One-click from AdVault

`POST /api/internal/sites`, bearer `INTERNAL_TOKEN` (Worker secret; same
value as advault-api `SITEVAULT_INTERNAL_TOKEN`). Same validation as the
public form, no attest field (attested in AdVault), no per-IP limit, 8 MB
photo limit. Replies `{ ok, slug, siteUrl, editUrl }`.

## Addresses (`src/address.ts`)

The business picks `<slug>.3pandasite.com`; the default is the shortest free one of name, name-type, name-town. Rules: 3-40 chars, a-z0-9 and single hyphens, RESERVED service words, and big-brand names refused (substring for long brands, whole word for short or ambiguous ones like "irs", "chase", "apple", so "first" and "pineapple" still pass). `GET /api/address` checks availability (public, CORS *). Renames: up to `MAX_RENAMES` (3) from the edit page; every old address is an `alias:<old>` KV key pointing at the current slug (no chains), served as a 301, and is never handed to anyone else. Photos keep their original R2 keys; the subdomain serves a file only if it is in that site's `photos`/`video`. `GET /api/internal/resolve?slug=` (INTERNAL_TOKEN) lets AdVault follow a rename.

## One website per business

No accounts, so the business PHONE is the identity: one live site per phone (`phone:<digits>` -> slug, `phoneIdentity` drops formatting and the US 1). Create (public and internal) and phone edits are refused with `PHONE_TAKEN`; removal frees the number; renames re-point it. Same name in the same town (`nt:<name>|<town>`) is only flagged (`possibleDuplicateOf`, in KV metadata and the admin list), never blocked. AdVault adds one site per AdVault account on top. Admin override for a shared number: delete the `phone:` key by hand.

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
