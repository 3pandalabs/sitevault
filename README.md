# SiteVault

A simple website for a local business in about five minutes, built from the
owner's own details and photos. By 3PandaLabs.

- Live: https://sitevault.3pandalabs.com
- Customer sites: `https://sitevault.3pandalabs.com/s/<slug>` today; moving
  to `<slug>.<customer-site domain>` once that domain is bought (see TODO.md).
- Works with [AdVault](https://advault.3pandalabs.com): a business without a
  website can get one here and use it as its video ad's link.

## Layout

```
web/        Cloudflare Worker (plain TypeScript, no framework)
  src/index.ts    routes, KV/R2 storage, create/edit/remove, ops endpoints
  src/site.ts     what a site is + validation (facts only, no links in text)
  src/render.ts   the customer site template (accessible, no JS, no cookies)
  src/pages.ts    SiteVault's own pages (home, builder, privacy, terms)
  test/           vitest
```

## Develop

```
cd web
npm install
npm test
npx tsc --noEmit
npx wrangler dev
npx wrangler deploy
```

Storage: KV namespace bound as `SITES`, R2 bucket `sitevault-photos` bound as `PHOTOS`.
