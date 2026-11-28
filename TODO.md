# SiteVault TODO

## Decisions pending (owner: Anil + Prachi)

- [x] **Pricing v2 DECIDED and BUILT (2026-11-15 evening; replaces $5 + $15/$20).**
      All plans billed yearly. Built free, pay when you publish (no build fee).

  | | Made on SiteVault | Made from AdVault |
  |---|---|---|
  | Build the site | **Free** (pay to publish) | **$10** one-time, charged in AdVault, includes year one of Pro |
  | Basic (keep it running) | **$49/year** | (they get Pro instead) |
  | Festive season prices | **Basic $29/year, Pro $59/year, locked for life**, if paid on or before 2027-01-31 (`FESTIVE_UNTIL`) | - |
  | Pro (visit stats) | **$89/year** | **$49/year** from year two |
  | New offer on the site | 1 credit | 1 credit |
  | Offer on the site AND as an AdVault ad | **$12** | **$12** |

  - Pitch: "Your business online in 2 minutes." Festive line on the home page:
    "Festive season price: $29/year, locked for life. Join before January 31,
    2027. After that, $49/year." Date-based on purpose: never show customer
    counts ("first 100") anywhere.
  - [ ] **AdVault side: charge the $10** with the ad checkout (one Stripe
    payment, optional line only when "Make me a website" was used). Until
    then AdVault-made sites get the year free.
  - [ ] Referral offer ("refer a business, you both get 6 months free"): not
    built; don't advertise it until it is.
  - [ ] Edit-page card for SiteVault-made sites: "Get your first customers from
    YouTube, first ad free" -> AdVault new-ad form prefilled (only on click).
  - [ ] Pro stats nudge toward ads (only with real comparison numbers).
  - Old prices ($5/$15/$20/$15) are inactive in Stripe use; no subscription
    ever used them.

  - **Separate products after creation.** A site's billing never depends on
    the owner's AdVault plan; cancelling AdVault changes nothing for the
    site. AdVault is only the referral (free build, Pro at $15). Needs
    SiteVault's own owner email + billing per site (see Build next).
  - **Offer credits: 1 credit = 1 offer** (a featured offer banner on the
    site). Every new site gets **2 free credits** (first two offers free).
    Then **5 credits for $10** (one Stripe charge instead of five $2 ones).
  - **Combo (site offer + AdVault offer ad) = $12 from either side** ($10 ad
    + $2 site offer). If the owner has a SiteVault credit, the site part uses
    1 credit and they pay $10.
  - **Pro stats, no cookies or trackers** (counted server-side in the
    Worker): visits per day/week/month, where visitors came from (Google,
    the YouTube ad, Facebook, WhatsApp, direct, from the Referer header /
    utm), city/country and device (Cloudflare request data), taps on Call,
    Directions and the offer. Update the privacy page in the same PR.
  - **Unpaid:** 14-day grace, then a simple "This site is paused" page that
    still shows the business name and phone. Never delete: an AdVault ad may
    point at the site, and paying again restores it instantly with all data.
  - Sites stay on `<slug>.3pandasite.com`. Customer-owned domains are a later
    upgrade (see Build next); we never register domains in our name for them.
  - When building: Stripe via the shared org account (`metadata.app =
    sitevault`), update the terms page "Price" section and the home-page pill
    in the same PR. AdVault side: the $12 combo is a new AdVault SKU that
    also posts the offer to SiteVault (internal API).
- [x] **Customer-site domain: 3pandasite.com** (bought 2026-11-15, Cloudflare Registrar, $11.17/yr, paid personally: reimbursable). Sites live at `<slug>.3pandasite.com`; `/s/<slug>` 301s there. Optional: buy `threepandasite.com` as a redirect.
- [ ] ~~Customer-site domain: pick a name and buy it~~ (done, kept for the record) (Cloudflare Registrar,
      about $10–15/year). Customer sites will move from
      `sitevault.3pandalabs.com/s/<slug>` to `<slug>.<domain>`. Name ideas
      (availability NOT checked yet):
  - `3panda.site`, e.g. `bellas-hair.3panda.site`
  - `sitevault.site`
  - `vaultsite.com`
  - `pandapage.site`
  - `shoppage.site`
  - `localpage.site`
  - `mybiz.page` (.page is HTTPS-only, fine for us)

  Once bought: add the zone to the 3PandaLabs Cloudflare account, add the
  `*.<domain>/*` route in `web/wrangler.jsonc`, set `SITES_DOMAIN`, and deploy.
  Keep old `/s/<slug>` links working (redirect to the new host).
- [x] **When an AdVault customer stops paying**: covered by the pricing
      decision above (site is billed on its own; unpaid = paused page, never
      deleted).

## Before taking paying customers (shared-domain risks)

All customer sites share 3pandasite.com, so one bad site or one domain
problem hits every customer (and every AdVault ad pointing at them).

- [ ] **Register a DMCA designated agent** at copyright.gov ($6, valid 3
      years) and add a copyright-complaint line to the terms. Use the
      Northwest Registered Agent address, never the home address (the
      directory is public). Do it after the Northwest switch.
- [ ] **Move 3pandasite.com billing to Mercury** (currently Anil's personal
      card ••3861, reimbursable). Keep auto-renew on; consider renewing
      several years ahead. If the domain lapses, every site goes down.
- [ ] **"Report this site" link** in every customer site's footer, wired to
      the admin takedown route. (2026-11-16: the mailto "Report this page"
      link and "This page sets no cookies." were removed from the footer at
      Anil's request; abuse reports now only reach us via the main site.
      Bring back a report link with a role address, not 3pandas@.) Answer abuse reports fast: an unanswered
      complaint can get the whole domain suspended.
- [ ] **Submit 3pandasite.com to the Public Suffix List**
      (github.com/publicsuffix/list, private section). Browsers and Google
      Safe Browsing then treat each `<slug>.3pandasite.com` as its own site,
      so one flagged site doesn't red-flag all of them. Needs a `_psl` TXT
      record; review takes weeks, so start early.
- [ ] Keep the abuse guardrails (facts only, no links in text, strict CSP,
      per-IP create limit); the $5 fee itself deters spam. Turn on Turnstile
      at the first sign of spam.
- [ ] Switch the domain's registrant address to the Northwest address with
      the rest of the privacy work.

## Build next

- [x] **One-click from AdVault** (2026-11-15): `POST /api/internal/sites`
      (bearer `INTERNAL_TOKEN` = advault-api `SITEVAULT_INTERNAL_TOKEN`),
      `source: "advault"`. AdVault sends name, category, phone, town, offer
      and the ad's polished photos, then saves the link on the campaign.
- [ ] **Owner email + lost-link recovery**: collect the owner's email
      (verified) and send the edit link through the shared `mailer` Worker
      (needs a MAILER_TOKEN and quota).
- [ ] **Forgot-password flow**: the login page still says "email us" because
      there is no self-service reset. Design one that works for SiteVault as a
      standalone app, not only for AdVault-linked accounts — AdVault users
      reset in AdVault (no password stored here), but native SiteVault accounts
      (`acct:<id>`, PBKDF2 hash) need their own reset. Likely an emailed,
      single-use, time-limited reset token via the `mailer` Worker (so it
      depends on the owner-email item above). Until built, keep the
      "email sitevault@3pandalabs.com" fallback on `/login`.
      Since 2026-11-16 (one 3PandaLabs account) new and moved accounts keep
      their password in AdVault only, so a reset belongs in AdVault's API
      and serves both apps; only unmoved or email-linked accounts still have
      a local PBKDF2 hash.
- [ ] **Contact form** on customer sites (delivered by email via `mailer`).
      Update the privacy page first: we'd then process visitors' messages.
- [ ] **Claude copy polish** (optional "write my About text"): facts-only
      prompt, same rule as AdVault's ads; needs ANTHROPIC_API_KEY as a secret.
- [ ] **Turnstile** on the create form if spam shows up (the daily per-IP
      limit is the only guard today).
- [ ] **Custom domains** for customers via Cloudflare for SaaS (custom
      hostnames: 100 free, then about $0.10/month each).
- [ ] **Call/text click tracking** reported to the business (and to AdVault
      as conversions), without cookies.

## Ops

- [ ] **Paid plans (code merged behind `BILLING=off`)**:
  - [ ] Apply the stats migration: `npx wrangler d1 migrations apply sitevault-stats --remote` (in `web/`; D1 id already in wrangler.jsonc).
  - [ ] Stripe (shared org account): create a restricted key (write: Checkout Sessions, Billing Portal, Subscriptions; read: Customers, Invoices), five prices (Build $5 one-time, Basic $15/yr, Pro $20/yr, Pro-AdVault $15/yr, Credits $10 one-time = 5 credits), enable the Customer Portal, and a webhook endpoint `https://sitevault.3pandalabs.com/webhooks/stripe` for `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`.
  - [ ] `wrangler secret put STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; set the `STRIPE_PRICE_*` vars in wrangler.jsonc.
  - [ ] Confirm `EARLY_ACCESS_UNTIL` (currently 2027-01-31), then flip `BILLING` to `"on"` and deploy. Test a Basic, a Pro, an upgrade and a credit pack in test mode first.

- [ ] Set `METRICS_TOKEN` (shared org token) and add SiteVault to the
      admin.3pandalabs.com Usage & resources table.
- [ ] Set `ADMIN_TOKEN` (takedowns: `POST /api/admin/sites/<slug>/remove`).
- [ ] Add SiteVault to knowledge_base `tech-stack.md` and an admin flow diagram.
- [ ] Add the product to the 3pandalabs website / product index repos.

## Leads, bookings, review requests (built 2026-11-27, not deployed)

- [ ] Deploy advault-api with the `/internal/sitevault/leads*` routes first, then this Worker.
- [ ] Pricing: all of it is on for every published site (`leadFeaturesOn`); decide if it becomes Pro-only (Anil).
- [ ] Optional: R2 lifecycle rule for `leads/` photos; Turnstile if spam shows up; calendar sync and deposits (v2).

