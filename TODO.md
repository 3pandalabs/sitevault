# SiteVault TODO

## Decisions pending (owner: Anil + Prachi)

- [ ] **Pricing.** Free during early access for now. Decide later:
      free with an AdVault ad (as its landing page)? standalone around
      $5–9/month? around $12/month with the customer's own domain? Check the
      AI site builders (Durable, Wix AI, Squarespace Blueprint, GoDaddy Airo,
      Hostinger AI) before deciding. Update the terms page "Price" section and
      the home-page pill when decided.
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
- [ ] **When an AdVault customer stops paying**: does their site stay live
      (free tier with the footer credit) or come down?

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
