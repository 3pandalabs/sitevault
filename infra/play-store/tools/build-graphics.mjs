// Renders the 1024 x 500 Play feature graphic in SiteVault's brand colours
// (dark zinc #09090b, sky #38bdf8 + violet #a78bfa wash), with the launcher
// icon from android/store_icon.png.
//
//   cd infra/play-store/tools && npm install && npm run graphics
//   out: ../graphics/feature-graphic.png
//
// The Play store icon (../graphics/play-icon-512.png) is the brand wordmark,
// brand/meta-kit/sitevault-profile.png flattened on #09090b and resized to
// 512 x 512 RGB (Play rejects alpha). It is not generated here.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const ICON = readFileSync(here("../../../android/store_icon.png")).toString("base64");

const FEATURE = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&display=swap" rel="stylesheet">
<style>
  html,body{margin:0}
  .f{width:1024px;height:500px;position:relative;overflow:hidden;font-family:Inter,sans-serif;
     background:radial-gradient(60% 80% at 0% 0%, rgba(56,189,248,.24) 0%, transparent 70%),
                radial-gradient(55% 75% at 100% 100%, rgba(167,139,250,.20) 0%, transparent 70%),#09090b;
     display:flex;align-items:center;gap:56px;padding:0 72px;box-sizing:border-box}
  .icon{flex:none;width:220px;height:220px;border-radius:48px;overflow:hidden;box-shadow:0 24px 48px -12px rgba(56,189,248,.35)}
  .icon img{width:220px;height:220px;display:block}
  h1{margin:0;font-size:84px;font-weight:800;letter-spacing:-2px;color:#fafafa}
  h1 b{color:#38bdf8;font-weight:800}
  p{margin:14px 0 0;font-size:34px;font-weight:500;line-height:1.25;color:#d4d4d8}
  p b{color:#a78bfa;font-weight:700}
  small{display:block;margin-top:22px;font:500 20px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:3px;color:#71717a}
</style></head><body><div class="f">
  <div class="icon"><img src="data:image/png;base64,${ICON}"></div>
  <div><h1>Site<b>Vault</b></h1><p>A website for your business.<br><b>Ready in about five minutes.</b></p><small>BY 3PANDALABS</small></div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await page.setContent(FEATURE, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: here("../graphics/feature-graphic.png"), clip: { x: 0, y: 0, width: 1024, height: 500 } });
console.log("1024x500 graphics/feature-graphic.png");
await browser.close();
