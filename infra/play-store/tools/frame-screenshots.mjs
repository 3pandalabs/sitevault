// Captioned versions of the raw screenshots for the Play listing: a 1080 x 1920
// canvas in SiteVault's brand colours (bg #09090b, fg #fafafa, sky #38bdf8 and
// violet #a78bfa wash), a headline on top, the phone screenshot below.
//
//   cd infra/play-store/tools && npm install && npm run frame
//   in:  ../screenshots/raw/*.png   out: ../screenshots/framed/<same name>.png
import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const RAW = here("../screenshots/raw/");
const OUT = here("../screenshots/framed/");
const files = existsSync(RAW) ? readdirSync(RAW).filter((f) => f.endsWith(".png")).sort() : [];
if (!files.length) throw new Error("No PNGs in screenshots/raw/: run `npm run screenshots` first.");
mkdirSync(OUT, { recursive: true });

// [headline, sub line], by raw file name. Anything else gets its file name.
const CAPTIONS = {
  "01-home.png": ["A website for your business", "Ready in about five minutes"],
  "02-how-it-works.png": ["Three simple steps", "Your details, your photos, your website"],
  "03-features.png": ["Everything customers look for", "Call, directions, hours and photos"],
  "04-builder.png": ["Build it on your phone", "No designer, no tech skills"],
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = (img, [title, sub]) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700&display=swap" rel="stylesheet">
<style>
  html,body{margin:0}
  .c{width:1080px;height:1920px;box-sizing:border-box;overflow:hidden;font-family:Inter,system-ui,sans-serif;
     display:flex;flex-direction:column;align-items:center;
     background:radial-gradient(70% 38% at 0% 0%, rgba(56,189,248,.28) 0%, transparent 70%),
                radial-gradient(60% 34% at 100% 4%, rgba(167,139,250,.24) 0%, transparent 70%),#09090b}
  .t{height:420px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 90px;box-sizing:border-box}
  h1{margin:0;font-size:76px;line-height:1.1;font-weight:700;letter-spacing:-1.5px;color:#fafafa}
  p{margin:26px 0 0;font-size:40px;line-height:1.25;font-weight:500;color:#38bdf8}
  .phone{width:840px;padding:18px;border-radius:64px;background:#27272a;box-shadow:0 40px 80px -24px rgba(56,189,248,.35)}
  img{display:block;width:100%;border-radius:48px}
</style></head><body><div class="c"><div class="t"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
<div class="phone"><img src="data:image/png;base64,${img}"></div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
for (const f of files) {
  const caption = CAPTIONS[f] ?? [f.replace(/^\d+-|\.png$/g, "").replace(/-/g, " "), ""];
  await page.setContent(html(readFileSync(RAW + f).toString("base64"), caption), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT + f });
  console.log(`framed ${f}  "${caption[0]}"`);
}
await browser.close();
