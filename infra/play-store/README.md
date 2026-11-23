# SiteVault on Google Play

The Android app is a **Trusted Web Activity** (`android/`, generated with Bubblewrap): Chrome shows `https://sitevault.3pandalabs.com` full screen, without a URL bar, starting at `/?source=twa`. There's no app code to keep in step. Every Worker deploy updates the app immediately. Rebuild the AAB only when the name, icon, colours, start URL, shortcuts or version change.

Package `com.threepandalabs.sitevault` · listing copy and policy answers: `listing.md`.

## Signing

- Upload key: `C:\Users\Anil\Documents\keys\sitevault-upload.jks`, alias `upload` (password in Claude memory `sitevault-upload-key`). SHA-256 `FF:63:A0:89:BD:68:BE:24:CD:75:17:C0:84:7A:5C:28:2B:26:31:19:B3:D0:CF:3E:D9:72:F0:26:C4:AC:03:3F`. **Back it up off this PC.** If it's lost, request an upload-key reset in Play Console.
- Google re-signs installs with the Play App Signing key. After creating the app, open Play Console → Test and release → Setup → App signing → "Copy all certificate fingerprints" and add **every** SHA-256 it lists (the classical App Signing key, the "Quantum-ready (beta)" key and any further signing certificate) to `ASSET_LINKS` in `web/src/pwa.ts`, then deploy the Worker **before** promoting a release. AdVault showed an address bar on a newer phone until all of them were listed (2026-11-22).
- Check: https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://sitevault.3pandalabs.com&relation=delegate_permission/common.handle_all_urls

## Build

```bash
cd android
export JAVA_HOME=~/.bubblewrap/jdk/jdk-17.0.21+9 ANDROID_HOME=~/.bubblewrap/android_sdk
# local.properties (untracked): sdk.dir=C:/Users/Anil/.bubblewrap/android_sdk
# bump appVersionCode (+1 every upload) and appVersionName in twa-manifest.json AND app/build.gradle
./gradlew bundleRelease assembleRelease
# sign (gradle output is unsigned):
#   AAB: jarsigner -keystore ../../keys/sitevault-upload.jks app/build/outputs/bundle/release/app-release.aab upload
#   APK: zipalign -p 4 app/build/outputs/apk/release/app-release-unsigned.apk aligned.apk
#        apksigner sign --ks ../../keys/sitevault-upload.jks --ks-key-alias upload --out app-release-signed.apk aligned.apk
# check: aapt2 dump badging <apk> | head -1   and   aapt2 dump permissions <apk>
```

Or `npx @bubblewrap/cli build` (prompts for the keystore password and signs both).

Signed builds are in `C:\Users\Anil\Documents\keys\sitevault-builds` (not in git): `sitevault-1.0.0-threepandalabs.aab` / `.apk` (1.0.0, versionCode 1). The older `sitevault-1.0.0.aab` / `.apk` there are the superseded `com.threepanda.sitevault` package: don't upload them.

## Graphics and screenshots

```bash
cd infra/play-store/tools && npm install
npm run graphics      # graphics/feature-graphic.png (1024x500)
npm run screenshots   # screenshots/raw/ (1080x1920) from the live site; SV_SITE=http://localhost:8787 for wrangler dev
npm run frame         # screenshots/framed/ (captioned; upload these)
```

- `graphics/play-icon-512.png`: Play store icon, the "SiteVault by 3PandaLabs" wordmark (brand/meta-kit/sitevault-profile.png flattened on #09090b, 512x512 RGB). The launcher icon inside the app stays the "S" mark (`android/store_icon.png`).
- Screenshots are the public pages only (home, how it works, what's on your site, the builder). Signed-in ones (edit page, stats) can be taken on a phone from the installed app, dropped into `screenshots/raw/` at 1080x1920 with a caption added in `frame-screenshots.mjs`, then `npm run frame`.

## First release (manual)

1. Play Console → Create app "SiteVault by 3PandaLabs", app, free; accept declarations.
2. Fill **App content** and **Store listing** from `listing.md`; upload the icon, feature graphic and framed screenshots.
3. Test and release → **Internal testing** → create release → upload the signed `sitevault-1.0.0-threepandalabs.aab`.
4. Copy all App Signing fingerprints into `web/src/pwa.ts`, deploy the Worker, verify with the link above, and install from the internal track: no URL bar = verified.
5. Promote to Production and submit for review. (Organization account: no 12-tester/14-day closed test rule.)
