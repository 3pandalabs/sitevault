// Captures the public screenshots from the live site at phone size,
// 1080 x 1920 (360 x 640 CSS px at 3x), into ../screenshots/raw/. Then
// `npm run frame` adds captions into ../screenshots/framed/ (upload those).
//
//   cd infra/play-store/tools && npm install && npm run screenshots
//   SV_SITE=http://localhost:8787 npm run screenshots   # from `wrangler dev`
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const RAW = here("../screenshots/raw/");
const SITE = process.env.SV_SITE ?? "https://sitevault.3pandalabs.com";
mkdirSync(RAW, { recursive: true });

// [file, path, CSS selector to scroll to the top of (null = page top)]
const SHOTS = [
  ["01-home.png", "/", null],
  ["02-how-it-works.png", "/", "#how-it-works"],
  ["03-features.png", "/", "#features"],
  ["04-builder.png", "/new", null],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
for (const [file, path, selector] of SHOTS) {
  await page.goto(SITE + path, { waitUntil: "networkidle" });
  if (selector) {
    const el = page.locator(selector).first();
    if (!(await el.count())) {
      console.warn(`skip ${file}: no ${selector} on ${path}`);
      continue;
    }
    await el.evaluate((n) => window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 8));
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: RAW + file });
  console.log(`captured ${file}`);
}
await browser.close();
