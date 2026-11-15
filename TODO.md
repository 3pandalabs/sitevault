# SiteVault TODO

## Decisions pending (owner: Anil + Prachi)

- [x] **Pricing DECIDED (2026-11-15, keep it simple)**. Not built yet; free
      during early access until payments ship.
  - **$5 one-time to create a site.** Waived when the site is made from
    AdVault ("Make me a website").
  - **$2/month upkeep, billed yearly as $24.** Stripe's fixed 30¢ would take
    about 18% of a $2 monthly charge but only about 4% of $24 a year.
    Standalone signup = $29 at checkout ($5 + first year), then $24/year.
  - **AdVault customers on an active plan** (Keep it running and up) pay no
    upkeep. A $10-ad-only customer (no plan) pays the $2/month (billed yearly)
    after the first month.
  - **Unpaid:** 14-day grace, then a simple "This site is paused" page that
    still shows the business name and phone. Never delete: an AdVault ad may
    point at the site, and paying again restores it instantly with all data.
  - Sites stay on `<slug>.3pandasite.com`. Customer-owned domains are a later
    upgrade (see Build next); we never register domains in our name for them.
  - When building: Stripe via the shared org account (`metadata.app =
    sitevault`), update the terms page "Price" section and the home-page pill
    in the same PR.
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
      decision above (falls to $2/month upkeep; unpaid = paused page, never
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
      the admin takedown route. Answer abuse reports fast: an unanswered
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

- [ ] Set `METRICS_TOKEN` (shared org token) and add SiteVault to the
      admin.3pandalabs.com Usage & resources table.
- [ ] Set `ADMIN_TOKEN` (takedowns: `POST /api/admin/sites/<slug>/remove`).
- [ ] Add SiteVault to knowledge_base `tech-stack.md` and an admin flow diagram.
- [ ] Add the product to the 3pandalabs website / product index repos.
