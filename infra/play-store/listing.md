# Google Play listing: SiteVault

Package `com.threepandalabs.sitevault` · Developer: 3PandaLabs LLC (organization account) · Category: **Business** · Free to install · No ads in the app · No purchases through Google Play Billing. SiteVault builds one-page websites for local businesses: free to build, paid yearly to publish (Basic $49/year, Pro $89/year with visitor stats; festive prices Basic $29/year and Pro $59/year, locked for life, if paid by January 31, 2027), plus offer credits (5 for $10), paid by card through Stripe Checkout on the web. US only. Google isn't requiring Play Billing for US users while the US court order stands (support.google.com/googleplay/android-developer/answer/15582165). Answer the Play Console payments declaration to match.

Every claim below matches the code as of 2026-11-25 (`web/src/billing.ts`, `wrangler.jsonc` BILLING=on, the /terms and /privacy pages). Update this file with any pricing or data change.

## App name (30)
SiteVault by 3PandaLabs

## Short description (80)
A simple website for your local business, built on your phone in five minutes.

## Full description (4000)
No website? Build one for your business in about five minutes, right from your phone.

Tell us your business name, what you do and your phone number, add a few photos, and SiteVault makes a clean, phone-friendly website that customers can call you from. You get your own web address, like yourbusiness.3pandasite.com.

HOW IT WORKS
• Type your details: name, services, hours, service area and address.
• Add photos of your shop, your team or your work.
• Pick a style and preview your website before anyone sees it.
• Publish, and share your link anywhere: Google, social media, business cards.

WHAT'S ON YOUR SITE
• Big tap-to-call buttons and directions, made for phones.
• Your services and prices, in your own words.
• Hours, service area and a map link.
• A photo gallery, and a menu or price list (PDF or photo) if you have one.
• Before & after photos, for trades like cleaning, landscaping, auto and car washes.
• A current special offer you can change from your phone.
• Reviews from your customers, shown only after you approve them.

YOUR SITE, YOUR FACTS
SiteVault shows only what you type. No made-up claims, no ads, no cookies and no trackers on your website.

SIMPLE PRICING
• Free to build. Pay only when you publish.
• Basic: $49 a year. Pro: $89 a year, with visitor stats (visits, where they came from, and call and directions taps).
• Festive season price: Basic $29 a year or Pro $59 a year, locked for life, when you join by January 31, 2027.
• Optional offer credits: 5 for $10.
• Billed yearly. Cancel any time; your site stays up until the end of the paid year.

Edit your website any time from the app. Your SiteVault sign-in also works in AdVault, our YouTube ads app for local businesses.

Made for plumbers, salons, restaurants, cleaners, dentists, mechanics and every local business that needs a place online.

Made by 3PandaLabs.

## Contact
- Email: sitevault@3pandalabs.com (the address the app and its policy pages show)
- Website: https://sitevault.3pandalabs.com
- Privacy policy: https://sitevault.3pandalabs.com/privacy
- Terms: https://sitevault.3pandalabs.com/terms
- Account deletion URL: https://sitevault.3pandalabs.com/privacy#delete-account ("Deleting your account": in the app, My website (/account) -> Delete my account signs in to AdVault at Settings -> Delete account; or AdVault Settings -> Delete account; or email. The website is removed separately, by email.)

## Graphics (infra/play-store/)
- `graphics/play-icon-512.png`: Play store icon, "SiteVault by 3PandaLabs" wordmark (brand/meta-kit/sitevault-profile.png).
- `graphics/feature-graphic.png`: 1024x500.
- Phone screenshots `screenshots/framed/01-home.png` … `04-builder.png`, 1080x1920. See README.md.

## App content answers
- **Ads:** No.
- **App access:** The home page and the website builder are open; publishing, editing and stats need an account (email + password; the builder creates it). A reviewer login exists (since 2026-11-22, the same 3PandaLabs account as AdVault; its password is never kept in this repo). Check its details are in "App access". Publishing a new site charges a real card (BILLING is on), unless the reviewer account is on the `ADMIN_EMAILS` comp list.
- **Target audience:** 18+ (business owners).
- **Content rating (IARC):** User-generated content is shared publicly: yes (each business publishes a public website with its own text and photos, and website visitors can leave reviews that the owner approves before they show). No chat or messaging between users. No location sharing (the business types its address; the app never reads device location). Digital purchases: yes (yearly website plans and offer credits, paid by card on the web). AI-generated content: no (the builder's one-tap suggestions are fixed templates; no AI).
- **News app:** No. **Government app:** No. **Health:** No.
- **Financial features:** None (no loans, banking, trading or crypto).
- **Data safety:**
  - Collected (from app users, i.e. business owners):
    - Email address: required (account sign-in); App functionality, Account management.
    - Name: optional (business name is required, but it's a business, not a personal name; declare Name as optional if the owner's own name is in it).
    - Phone number: required (the business phone, published on the site); App functionality.
    - Address: optional (business street address, published on the site); App functionality.
    - User IDs: required (3PandaLabs account ID); Account management.
    - Photos: optional (business photos, before & after photos); App functionality.
    - Videos: optional (only sites made from AdVault, whose ad video AdVault sends); App functionality.
    - Files and docs: optional (menu, price list or schedule PDFs); App functionality.
    - Other user-generated content: services, hours, offers, about text; App functionality.
    - Purchase history: yes, if they pay (plan, paid-until date, Stripe customer/subscription IDs, payer email); App functionality.
    - Card details are entered on Stripe's page and never reach SiteVault.
  - Shared with third parties: none. Publishing on the user's own website is a user-initiated action (not "sharing"). Stripe (payments) and Cloudflare (hosting) are service providers. The sign-in is stored by AdVault, which is the same developer (3PandaLabs LLC).
  - Not collected: device location, contacts, audio, device or advertising IDs, app activity, crash logs. No analytics or crash SDK. Visit counts on customer websites are aggregate totals about website visitors, not about app users.
  - Encrypted in transit: Yes. Users can request deletion: Yes (in the app via My website -> Delete my account, or by email; https://sitevault.3pandalabs.com/privacy#delete-account).
  - Account creation method: email + password (an existing AdVault account also works).
- **Permissions in the AAB:** none user-facing (verified with `aapt2 dump badging` / `dump permissions` on build 1.0.0 (1): only the library's internal `com.threepandalabs.sitevault.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`). Photo uploads use the system file picker through Chrome.
