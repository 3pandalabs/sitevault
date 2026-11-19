# Password reset & shared transactional email — agreed design

_Status: agreed 2026-11-18. Spans 4 repos + DNS/Resend ops. Driven by SiteVault,
but the email foundation is org-wide._

## Decisions (what we settled on)

| Area | Decision |
|---|---|
| **Identity** | **Coupled** — one 3PandaLabs account; SiteVault/AdVault passwords live in AdVault's `users` table. SiteVault proxies auth to AdVault. |
| **Reset flow lives in** | **AdVault** (that's where the password is). SiteVault only hosts the two pages + proxies. |
| **Reset pattern** | Copy **BorrowVault** (`borrowvault/api/src/routes/auth.ts`): random 32-byte token, **bcrypt-hashed**, stored in a `password_reset_tokens` table, **30-min TTL**, single-use (atomic consume), enumeration-safe `204`. |
| **Email transport** | The **shared gateway** `3pandalabs/mailer` (`POST https://mailer.3pandalabs.com/send`, Resend under the hood). **Not** Gmail SMTP, **not** EviteVault's inline Cloudflare REST mailer. |
| **Sender** | Shared neutral address **`passwordReset@3pandalabs.com`** for every app, with a **per-product `fromName`** ("SiteVault", "BorrowVault", "AdVault", …). |
| **Resend plan** | **Option A — free.** Make `3pandalabs.com` the single verified Resend domain; **retire `rsvpvault.3pandalabs.com`** and move EviteVault's sender to `invitations@3pandalabs.com`. |

Why a neutral `@3pandalabs.com` sender: it removes the blocker that a reset from
`@rsvpvault` is "a phishing signature." A reset from the parent brand is
legitimate for every product (coupled or standalone), and it's honest for the
coupled apps whose login _is_ a 3PandaLabs account.

## `3pandalabs.com` DNS today (checked 2026-11-18)

- MX → **Cloudflare Email Routing** (not Google Workspace).
- SPF → `v=spf1 include:_spf.mx.cloudflare.net ~all` (no Resend/Google yet).
- DMARC → `p=none; rua=mailto:rua@dmarc.brevo.com` (monitoring only).
- Not verified on Resend (the gateway's one domain is `rsvpvault.3pandalabs.com`).

## Workstreams

### 1. DNS + Resend (ops; external to code) — the gating step
Resend **free plan = exactly one verified domain**, so this is a swap, not an add:
1. In the Resend dashboard, start verifying **`3pandalabs.com`**; add the **DKIM +
   MAIL-FROM records Resend provides** to the Cloudflare DNS zone. (Resend uses its
   own return-path subdomain for SPF, so the apex SPF likely needs no change —
   follow the exact records Resend shows.)
2. Because free = one domain, **deleting `rsvpvault` is required** to activate
   `3pandalabs.com`. Do this only after EviteVault + mailer config are ready to
   switch (see Sequencing), so invitations don't break.
3. Keep DMARC `p=none` initially; tighten later once mail is flowing cleanly.
4. Add a **Cloudflare Email Routing rule**: `passwordReset@3pandalabs.com` →
   forward to a monitored inbox (so replies/"I didn't request this" land
   somewhere). Alternatively set `Reply-To:` on the messages.

### 2. `3pandalabs/mailer` repo
- `wrangler.jsonc`:
  - `APP_SENDERS`: set every participating app to `["passwordReset@3pandalabs.com"]`
    (and EviteVault to `["invitations@3pandalabs.com"]`). Remove the `rsvpvault`
    address.
  - `APP_QUOTAS`: add `advault`, `sitevault`, `borrowvault` (small, e.g. 20/day each);
    keep the sum under the Resend account cap (free = 100/day, 3000/mo).
- Secret `APP_TOKENS`: add a per-app bearer token for `advault` (and `borrowvault`
  if it migrates). SiteVault itself does **not** send — it proxies to AdVault — so
  SiteVault needs no mailer token.

### 3. AdVault repo — the real work (it has no reset today)
Build the reset flow (copy BorrowVault's `auth.ts` + `password_reset_tokens`
table + bcrypt), and expose **internal endpoints** for SiteVault to proxy, bearer
`INTERNAL_TOKEN`, on `api-internal.advault.3pandalabs.com` (same pattern as the
existing `verify-login`, `/internal/sitevault/accounts`, `/usage`):

```
POST /internal/sitevault/password-reset/request
  body: { email: string, app: "sitevault" | "advault" | ..., fromName: string }
  → always 204 (enumeration-safe). If the email maps to a 3PandaLabs account:
    mint token, store bcrypt hash + 30-min TTL, send via the gateway from
    passwordReset@3pandalabs.com with the given fromName and a link to the
    requesting app's /reset-password?token=<id>.<secret>.

POST /internal/sitevault/password-reset/confirm
  body: { token: string, newPassword: string }
  → 200 on success (token valid, unused, unexpired → set password, atomically
    consume token, revoke sessions). 400 on invalid/expired/used or weak password.

POST /internal/sitevault/change-password   (signed-in change)
  body: { userId|email, currentPassword, newPassword }
  → verifies current, sets new. 401 if current wrong.
```
AdVault owns token storage, hashing, the send, and password rules. The reset-link
host is passed per request so each app's email links back to its own domain.

### 4. SiteVault repo — thin
- Pages: `GET/POST /forgot-password` (email → calls AdVault `…/request`), and
  `GET/POST /reset-password` (new password → calls AdVault `…/confirm`). Reuse the
  existing `sameOrigin` CSRF gate + `authRateLimited`. Enumeration-safe copy
  ("if that email has an account, we've sent a link").
- Add a **"Change password"** control on `/account` → AdVault `…/change-password`.
- Replace the stale **"Forgot your password? Email 3pandas@…"** copy on `/login`
  (pages.ts ~964) with a link to `/forgot-password`.
- SiteVault stores no reset token and holds no email secret.

### 5. EviteVault migration (must not break live invitations)
- Change its sender from `invitations@rsvpvault.3pandalabs.com` to
  `invitations@3pandalabs.com` (its `mailer`/config). Sends are fail-soft, so a
  brief gap during the swap only skips+logs, never crashes — but do it at low
  traffic.

### 6. BorrowVault (optional cleanup)
- Once `3pandalabs.com` is the gateway domain, BorrowVault can drop its **Gmail
  SMTP** workaround and send reset mail through the gateway from
  `passwordReset@3pandalabs.com` (fromName "BorrowVault"). Nice-to-have, not required.

## Sequencing (so nothing live breaks)
1. Pre-stage Cloudflare DNS records for Resend `3pandalabs.com` verification.
2. Prepare (don't deploy) the mailer `APP_SENDERS`/`APP_TOKENS`/`APP_QUOTAS` change
   and EviteVault's new sender.
3. Low-traffic window: in Resend, remove `rsvpvault`, verify `3pandalabs.com`;
   deploy mailer + EviteVault config together. Send a test invitation + test reset.
4. Build AdVault reset endpoints; then SiteVault's two pages; then flip the
   `/login` copy. (BorrowVault migration whenever.)

## Guardrails (don't skip)
- **Rate-limit the reset request** per-IP and per-account (we're not getting the
  gateway's per-app DO quota as abuse protection for the _request_ endpoint).
- **Enumeration-safe** everywhere (always the same response).
- **Token hygiene**: single-use, short TTL, hashed at rest, revoke sessions on
  reset.
- **Keep transport behind one `sendMail()` seam** in AdVault so provider changes
  are one-file.

## Known long-term trade-offs (accepted)
- Coupled identity → SiteVault auth depends on AdVault uptime; shared credential
  blast radius (disclosed in terms); auth changes need AdVault coordination.
- Free Resend = one domain + 100/day, 3000/mo cap shared across all apps. Fine for
  resets; revisit (paid plan / dedicated sending subdomain) if volume grows or the
  lead/contact form ships.
- Apex `3pandalabs.com` sending mixes transactional + corporate reputation;
  acceptable at low volume. A dedicated `send.`/`mail.` subdomain is the future
  hardening step.

## Cutover runbook (Option A) — recorded 2026-11-18

Order matters (Resend free plan = one verified domain; adding `3pandalabs.com`
evicts `rsvpvault`).

1. **Resend → verify `3pandalabs.com`.** Delete `rsvpvault`, Add Domain
   `3pandalabs.com`, add the records Resend shows (currently **2 CNAME + 1 TXT**)
   to Cloudflare DNS as **DNS only (grey cloud)**. Do NOT edit the existing apex
   SPF or `_dmarc`. Click **Verify**.
2. **Cloudflare Email Routing** (optional): add `passwordreset@3pandalabs.com`
   (lowercase) → forward to a monitored inbox, so replies land somewhere.
3. **Token:** `openssl rand -hex 32` → this is `ADVAULT_MAILER_TOKEN`, used in
   BOTH places below.
4. **Mailer `APP_TOKENS`** (Cloudflare secret, replaces the whole value — keep
   evitevault's): `{"evitevault":"<existing>","advault":"<ADVAULT_MAILER_TOKEN>"}`.
   Dashboard: Workers → mailer → Settings → Variables and Secrets. Or
   `npx wrangler secret put APP_TOKENS`.
5. **Deploy mailer** (`mailer` PR #7: adds the `advault` sender + quota, moves
   senders to `3pandalabs.com`) — only AFTER step 1 verifies.
6. **advault-api (Coolify) env:** `MAILER_URL=https://mailer.3pandalabs.com`,
   `MAILER_TOKEN=<ADVAULT_MAILER_TOKEN>`. Redeploy.
7. **Merge + deploy** advault#116 then sitevault#78.
8. **Test:** SiteVault `/forgot-password` with a real account → check inbox.

NOTE (2026-11-18): EviteVault sends `invitations@3pandalabs.com` via **Cloudflare
Email Sending**, NOT this gateway and NOT Resend. So the Resend `rsvpvault`
eviction does not affect it. If EviteVault mail breaks during this cutover, look
at `3pandalabs.com` DNS (apex SPF / `_dmarc` / existing DKIM), not Resend.
