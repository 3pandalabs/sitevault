# SiteVault: notes for Claude

10th 3PandaLabs product (2026-11-15). Instant one-page websites for local
businesses that have none. Born from AdVault, where a website became optional
(AdVault PR #76) and launch needs a link. Idea record: 3pandalabs/ideas
`ideas/sitevault.md`. Open decisions and next work: `TODO.md`.

## Shape

- **One Cloudflare Worker, no server** (`web/`); D1 only for visit stats (see Billing & stats). KV `SITES`
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

**Customer-site templates (`src/templates.ts`, 2026-11-16):** the owner picks
one of 3 static layouts at build time (`site.template`, default `spotlight`):
`spotlight` (full-bleed photo hero), `split` (text panel + image), `editorial`
(centred, serif headings, image band). Still no JS, no web fonts, facts only —
the template only changes the hero layout, typography (`--head-font`) and
spacing; every section is shared. `themeFor(category, brand)` returns the
palette: `landscaping` is hand-tuned from the local-business blueprints, the
other 17 fall back to a light palette derived from the category's brand colour
(Phase 2 tunes each). `renderSite` dispatches on `asTemplate(site.template)`;
the builder shows a radio-card picker ("Website style"). The interactive parts
of the blueprints (calculators, sliders, booking drawers, live tickers) are
intentionally NOT built — they'd need JS and often fabricated data, both
against SiteVault's rules.

## One-click from AdVault

`POST /api/internal/sites`, bearer `INTERNAL_TOKEN` (Worker secret; same
value as advault-api `SITEVAULT_INTERNAL_TOKEN`). Same validation as the
public form, no attest field (attested in AdVault), no per-IP limit, 8 MB
photo limit. Replies `{ ok, slug, siteUrl, editUrl }`.

**Offer combo** (AdVault's $12 = $10 offer ad + the same offer on the site;
$10 if the site uses 1 SiteVault credit; always PAID in AdVault). Both
INTERNAL_TOKEN, both follow renames (`alias:` keys) like resolve:
- `GET /api/internal/sites/<slug>/offer-status` -> `{ ok, slug, offer, credits,
  billing: "on"|"off", siteState }` (AdVault quotes the combo from this).
- `POST /api/internal/sites/<slug>/offer` JSON `{ offer, payment: "advault"|"credit",
  ref }` -> `{ ok, slug, offer, credits, creditShort? }`. Offer validated by the
  edit form's rules (`parseInternalOffer`, site.ts), non-empty. "advault" spends
  nothing; "credit" follows `internalOfferSpend` (billing.ts): with 0 credits the
  offer is still set, `offer_credit_short` is logged and `creditShort: true`
  returned. Idempotent on `ref` (AdVault's purchase id): KV `offerref:<ref>`, 30
  days, a repeat replays the first result. Re-reads the site right before saving
  so a webhook write isn't clobbered.
- **$10 website fee (2026-11-15):** AdVault creates with form field `awaitingPayment=1` when it charges; the site is then `pending` (unpublished, plan pro) until `POST /api/internal/sites/<slug>/paid` `{ ref }` (AdVault's purchase id, idempotent via KV `paidref:<ref>`) applies `applyAdvaultPaid` (active, a year of Pro). The edit page sends an unpaid AdVault site back to AdVault ("Finish in AdVault"). Without the field (admins, at_cost) the site is live at once as before.
- **Ad video at launch (2026-11-16):** AdVault no longer sends the ad video on internal create; it sends it when the ad LAUNCHES (the reason to launch) via `POST /api/internal/sites/<slug>/video` (multipart `video`, MP4 ≤ 40 MB, INTERNAL_TOKEN, AdVault-made sites only, follows aliases). Replaces any earlier video and deletes the old file. It stays on the site afterwards.
- The edit page's offer field links to AdVault: `advault.3pandalabs.com/dashboard?siteOffer=<slug>`
  for AdVault-made sites, AdVault's home ("Turn this offer into a video ad") otherwise.

## Addresses (`src/address.ts`)

The business picks `<slug>.3pandasite.com`; the default is the shortest free one of name, name-type, name-town. Rules: 3-40 chars, a-z0-9 and single hyphens, RESERVED service words, and big-brand names refused (substring for long brands, whole word for short or ambiguous ones like "irs", "chase", "apple", so "first" and "pineapple" still pass). `GET /api/address` checks availability (public, CORS *). Renames: up to `MAX_RENAMES` (3) from the edit page; every old address is an `alias:<old>` KV key pointing at the current slug (no chains), served as a 301, and is never handed to anyone else. Photos keep their original R2 keys; the subdomain serves a file only if it is in that site's `photos`/`video`. `GET /api/internal/resolve?slug=` (INTERNAL_TOKEN) lets AdVault follow a rename.

## Owner accounts (`src/accounts.ts`, 2026-11-15)

Email + password (PBKDF2-SHA256, 100k iterations, the Workers max). KV: `acct:<id>`, `acctemail:<email>` -> id, `sess:<sha256(token)>` -> id (30 days). Cookie `sv_session` (HttpOnly, Secure, SameSite=Lax) on the MAIN site only; customer sites never get a cookie. The build form signs you up (fields `acct_email`/`acct_password`) unless signed in; the site gets `ownerId` and joins `account.sites`. Pages: `/login`, `/signup`, `/account` (My websites), `POST /logout`, `POST /account/claim` (paste an old edit link to adopt a site). `authorize()` accepts the edit key OR the owner session; session-only POSTs need `Origin` = PUBLIC_ORIGIN. 10 auth tries per IP per 15 min. **One website per account:** `/new` redirects an owner who has a site to `/account`, create and claim refuse a second one, and the nav/home show "My website" instead of "Build my website" (`layout({ owner })`). No password-reset email yet (says email us). **Same login as AdVault:** when the SiteVault password doesn't match, `/login` asks AdVault `POST {ADVAULT_API_URL}/internal/sitevault/verify-login` (bearer INTERNAL_TOKEN; ADVAULT_API_URL is the DNS-only api-internal host) and signs them in to the account linked to that AdVault user (`accountForAdvault`: KV `acctadv:<advaultUserId>`, else same email, else a new password-less account). AdVault sends `ownerAdvaultUserId`/`ownerEmail` on internal create, and backfills older sites via `POST /api/internal/sites/<slug>/owner` (never moves an owned site). The AdVault password is never stored here.

## One 3PandaLabs account (2026-11-16)

**The login lives in AdVault's `users` table, shared by AdVault and SiteVault**
(advault `lib/sharedAccount`, `api/ROUTES.md` "Internal: SiteVault"). The KV
`acct:` record keeps SiteVault's part (sites, sessions) linked by
`advaultUserId`. Helpers in `src/accounts.ts`, all bearer `INTERNAL_TOKEN` to
`ADVAULT_API_URL`, 8 s timeout, never throw:

- **Sign-up** (`/signup` and the build form, `signUpShared`): `POST
  /internal/sitevault/accounts` creates the user with `signup_app = sitevault`;
  the KV account gets `advaultUserId` and `pw: null`, and `/login` then checks
  the password with AdVault (verify-login). 409 `email_exists` = "already has a
  3PandaLabs account, sign in" (never linked: a sign-up proves nothing). AdVault
  down or unconfigured = a local-password account, moved later. New passwords
  need 10+ characters (AdVault's rule); older 8-9 character ones still work.
- **Lazy move** (`moveToSharedAccount`, in `authSubmit`): an account with `pw`
  and no `advaultUserId` that signs in with its SiteVault password is created in
  AdVault with that password, its original `createdAt` and its first site's time.
  Created = local `pw` dropped. Email already in AdVault = linked, NEITHER
  password changed, local `pw` kept (so both passwords work, as before). Never
  relinks an AdVault id held by another account. Failure = unchanged, retried
  next sign-in.
- **Usage** (`markSitevaultUsed` / `reportSitevaultUse`, `ctx.waitUntil`): `POST
  /internal/sitevault/usage` when an owner creates or claims a site and on every
  sign-in of a linked account that has one (self-healing for older sites and
  failed reports). AdVault stamps `sitevault_first_used_at`; its
  `account_app_usage` view defines **SiteVault-only = has a SiteVault website
  and never made an AdVault campaign** (advault CLAUDE.md "One 3PandaLabs
  account"). AdVault stamps sites it makes through "Make me a website" itself.
- **Deploy order**: advault-api first (the routes must exist), then this
  Worker. No new secrets: the same `INTERNAL_TOKEN` / `ADVAULT_API_URL`.
- Availability: a moved or new account can only sign in while AdVault's API
  answers. Accepted for one source of truth (no stale second password).
- Privacy and terms pages (`pages.ts`) describe the shared account; change them
  with any change to what it stores.

## One website per business

No accounts, so the business PHONE is the identity: one live site per phone (`phone:<digits>` -> slug, `phoneIdentity` drops formatting and the US 1). Create (public and internal) and phone edits are refused with `PHONE_TAKEN`; removal frees the number; renames re-point it. Same name in the same town (`nt:<name>|<town>`) is only flagged (`possibleDuplicateOf`, in KV metadata and the admin list), never blocked. AdVault adds one site per AdVault account on top. Admin override for a shared number: delete the `phone:` key by hand.

## Billing & stats

- **Switch: `BILLING` var** (wrangler.jsonc, default `"off"`). Off = everything free, exactly as before (no billing record is stored on new sites, no paused pages, offers free). On = the plans in `src/billing.ts` (pure rules, unit-tested): SiteVault-made sites are free to build and start `pending` (unpublished) until Basic $49/yr or Pro $89/yr is paid; **festive season price** (`FESTIVE_UNTIL`, 2027-01-31): Basic $29/yr and Pro $59/yr locked for life (`billing.festive`, Stripe prices BASIC_FESTIVE / PRO_FESTIVE); AdVault-made sites are live with a year of Pro (the $10 AdVault charges), then Pro $49/yr; 2 free offer credits per site, 5 more for $10. 14-day grace after `paidUntil`, then a "paused" page (name + phone). Sites with no `billing` field (made before the switch) are paid until `EARLY_ACCESS_UNTIL`.
- **Admin comp (`ADMIN_EMAILS`)**: a comma-separated allowlist of owner emails (3PandaLabs admins). A site created by a signed-in owner whose email is on the list gets `compBilling()` (`billing.comp = true`): published free at once, `siteState` always `live`, never pending or paused, no pay buttons (billing section shows "Comped (free)"). Admins are also **exempt from one-website-per-account** (the `/new` redirect, the create check and the claim check all skip them, and `/account` shows "Build another website"). **`GET /admin`** (session-gated by `isAdminEmail`, not `ADMIN_TOKEN`) is their dashboard: tabs for status totals (published/unpublished/overdue/paused), per-category counts, and a list of every live site. It loads every site, so it's fine at current scale but would need richer key metadata to scale. `isAdminEmail` (index.ts) is the check; it's only as strong as the account's email until email verification exists, so the admin should claim the email by signing up first.
- **Stripe via fetch** (`src/stripe.ts`, no SDK), shared org account. Secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; vars `STRIPE_PRICE_BASIC/BASIC_FESTIVE/PRO/PRO_FESTIVE/PRO_ADVAULT/CREDITS`. Missing ones make only checkout/portal (and the webhook) answer 503.
- Routes: `POST /api/billing/checkout`, `POST /api/billing/portal` (edit key in the form), **webhook `POST /webhooks/stripe`** (signature-checked). Everything is tagged `metadata.app = "sitevault"`; the webhook acknowledges and **ignores events for any other app**. Processed event ids live in KV `evt:<id>` for 30 days (no double credits). Upgrades = a new Checkout; the webhook cancels the replaced subscription with proration.
- **D1 `STATS`** (database `sitevault-stats`, `web/migrations/`): aggregate `daily` counters per slug/day/source/country/city/device; views and call/directions taps (HTML `ping`, `POST /t/<kind>` on the customer host, no JS). No IP, UA or full referrer stored. Written via `ctx.waitUntil`; skipped if the binding is absent. Pro (or BILLING off) sees the breakdown on the edit page; Basic sees the 30-day total.

## Rules that matter

- **Facts only.** A site shows only what the business typed. No generated
  claims. If Claude copy help is added, the prompt must forbid invented facts.
- **No links in free text** (`LINK_PATTERN` in `site.ts`): a business card,
  not a redirect page, so SiteVault can't become a phishing host.
- **Escape everything** with `esc()`; JSON-LD via `jsonForScript()`. Strict CSP:
  the only script anywhere is FIRST-PARTY and nonce'd (`script-src 'nonce-…'`,
  no external/eval). Customer sites run one small inline motion script (`SITE_JS`
  in `render.ts`: scroll reveals, hero ken-burns, gallery lightbox) — progressive
  (works with JS off via the `.js` class gate), reduced-motion aware, no network,
  no cookies, no trackers. Hold pages (`renderHold`) stay script-free. Builder
  pages use their own per-response nonce.
- **Accessibility is required** (US ADA website suits): landmarks, headings,
  alt text, focus outlines, 44px targets, 4.5:1 contrast for every
  `CATEGORIES[*].brand` colour against white.
- **Privacy**: no third-party analytics or trackers, on SiteVault or
  customer sites; the ONLY cookie is the sign-in cookie on the main site, set only when someone signs in (our own aggregate visit counts are described on the privacy page). Maps are a link, never an embed. Change the privacy page in the
  same PR as any change to what is stored.
- Edit access is a **secret edit key** (only its SHA-256 is stored), shown
  once on the done page. **No self-service delete** (2026-11-15): owners email 3pandas@3pandalabs.com; ops confirms by calling the site phone, cancels any Stripe subscription, checks no AdVault campaign links to it, then `POST /api/admin/sites/<slug>/remove` (ADMIN_TOKEN). Removal deletes photos and keeps a `removed` record
  so the slug isn't reused.
- `/metrics` uses the shared org envelope (`app/collectedAt/uptimeSeconds/
  counts/traffic/process/database`); `traffic/process/database` are null for
  a Worker, same as MealMargin.

## Git

Branch, PR, merge; never `git add -A`. Commit identity per the org
convention (3pandalabs-admin noreply).
