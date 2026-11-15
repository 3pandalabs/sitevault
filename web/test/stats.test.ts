import { describe, expect, it } from "vitest";
import { classifySource, deviceOf, hitFor, hostSource, isBot, isPrefetch, normaliseUtm, tapSource } from "../src/stats.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

describe("isBot", () => {
  it("lets real browsers through", () => {
    for (const ua of [IPHONE, ANDROID_PHONE, ANDROID_TABLET, IPAD, DESKTOP]) expect(isBot(ua)).toBe(false);
  });
  it("skips crawlers, link-preview fetchers and scripts", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "WhatsApp/2.23.20.0 A",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0",
      "TelegramBot (like TwitterBot)",
      "Mozilla/5.0 (compatible; Yahoo! Slurp)",
      "AdsBot-Google (+http://www.google.com/adsbot.html)",
      "Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/120.0",
      "curl/8.4.0",
      "python-requests/2.31",
      "",
      null,
    ]) {
      expect(isBot(ua)).toBe(true);
    }
  });
});

describe("isPrefetch", () => {
  it("detects speculative loads", () => {
    expect(isPrefetch(new Headers({ "sec-purpose": "prefetch" }))).toBe(true);
    expect(isPrefetch(new Headers({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isPrefetch(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetch(new Headers({}))).toBe(false);
  });
});

describe("deviceOf", () => {
  it("classifies phones, tablets and computers", () => {
    expect(deviceOf(IPHONE)).toBe("mobile");
    expect(deviceOf(ANDROID_PHONE)).toBe("mobile");
    expect(deviceOf(ANDROID_TABLET)).toBe("tablet");
    expect(deviceOf(IPAD)).toBe("tablet");
    expect(deviceOf(DESKTOP)).toBe("desktop");
    expect(deviceOf(null)).toBe("desktop");
  });
});

describe("source", () => {
  const own = "bellas.3pandasite.com";
  const page = (q = "") => new URL(`https://${own}/${q}`);

  it("normalises utm_source", () => {
    expect(normaliseUtm("YouTube")).toBe("youtube");
    expect(normaliseUtm("yt")).toBe("youtube");
    expect(normaliseUtm("google_ads")).toBe("google");
    expect(normaliseUtm("fb")).toBe("facebook");
    expect(normaliseUtm("ig")).toBe("instagram");
    expect(normaliseUtm("wa")).toBe("whatsapp");
    expect(normaliseUtm("advault")).toBe("advault");
    expect(normaliseUtm("newsletter")).toBe("other");
  });

  it("prefers utm_source over the referrer", () => {
    expect(classifySource(page("?utm_source=youtube"), "https://www.google.com/", own)).toBe("youtube");
  });

  it("classifies referrer hosts", () => {
    expect(classifySource(page(), "https://www.google.com/", own)).toBe("google");
    expect(classifySource(page(), "https://www.google.co.in/", own)).toBe("google");
    expect(classifySource(page(), "https://m.youtube.com/watch?v=x", own)).toBe("youtube");
    expect(classifySource(page(), "https://youtu.be/x", own)).toBe("youtube");
    expect(classifySource(page(), "https://l.facebook.com/", own)).toBe("facebook");
    expect(classifySource(page(), "https://m.facebook.com/", own)).toBe("facebook");
    expect(classifySource(page(), "https://fb.com/", own)).toBe("facebook");
    expect(classifySource(page(), "https://l.instagram.com/", own)).toBe("instagram");
    expect(classifySource(page(), "https://wa.me/", own)).toBe("whatsapp");
    expect(classifySource(page(), "https://web.whatsapp.com/", own)).toBe("whatsapp");
    expect(classifySource(page(), "https://example.org/a", own)).toBe("other");
  });

  it("does not mistake look-alike hosts", () => {
    expect(hostSource("notgoogle.com")).toBe("other");
    expect(hostSource("youtube.com.evil.net")).toBe("other");
  });

  it("treats no referrer, its own host, or junk as direct", () => {
    expect(classifySource(page(), null, own)).toBe("direct");
    expect(classifySource(page(), `https://${own}/`, own)).toBe("direct");
    expect(classifySource(page(), "not a url", own)).toBe("direct");
  });

  it("takes a tap's source from the page's utm_source, else direct", () => {
    expect(tapSource(`https://${own}/?utm_source=youtube`, null)).toBe("youtube");
    expect(tapSource(null, `https://${own}/?utm_source=fb`)).toBe("facebook");
    expect(tapSource(`https://${own}/`, `https://${own}/`)).toBe("direct");
    expect(tapSource(null, null)).toBe("direct");
  });
});

describe("hitFor", () => {
  it("keeps only day, source, rough location and device", () => {
    const hit = hitFor("bellas", "google", { country: "US", city: "Secaucus" }, IPHONE, new Date("2026-11-15T23:00:00Z"));
    expect(hit).toEqual({ slug: "bellas", day: "2026-11-15", source: "google", country: "US", city: "Secaucus", device: "mobile" });
  });
  it("tolerates a missing or odd cf object", () => {
    const hit = hitFor("bellas", "direct", undefined, DESKTOP, new Date("2026-11-15T00:00:00Z"));
    expect(hit.country).toBe("");
    expect(hit.city).toBe("");
    expect(hitFor("b", "direct", { country: "<script>" }, DESKTOP, new Date()).country).toBe("");
  });
});
