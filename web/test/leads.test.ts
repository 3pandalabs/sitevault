// Leads, bookings and review links (leads.ts) and the QR encoder (qr.ts): pure rules.
import { describe, expect, it } from "vitest";
import {
  bookingWhen,
  freeSlots,
  isoInZone,
  leadFeaturesOn,
  openDates,
  parseLeadInput,
  parseLeadSettings,
  parseReviewLink,
  reviewUrlFor,
  sourceFromFields,
  sourceFromRequest,
  timezoneFor,
  zonedToUtc,
  type BookingSettings,
} from "../src/leads.js";
import { qrMatrix, qrSvg } from "../src/qr.js";

const NINE_FIVE = [{ start: "09:00", end: "17:00" }];
const settings = (over: Partial<BookingSettings> = {}): BookingSettings => ({
  on: true,
  services: [{ name: "Haircut", durationMin: 30, price: "$25" }],
  weekly: [[], NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, []],
  timezone: "America/New_York",
  leadHours: 2,
  daysAhead: 30,
  ...over,
});

describe("plan gate", () => {
  it("is on for every site for now (Basic, Pro and AdVault-made)", () => {
    expect(leadFeaturesOn({ source: "web", billing: undefined })).toBe(true);
    expect(leadFeaturesOn({ source: "advault", billing: undefined })).toBe(true);
  });
});

describe("timezoneFor", () => {
  it("reads the state from the town or the address, Eastern otherwise", () => {
    expect(timezoneFor({ city: "Austin, TX", address: null })).toBe("America/Chicago");
    expect(timezoneFor({ city: "Secaucus", address: "1 Main St, Secaucus, NJ 07094" })).toBe("America/New_York");
    expect(timezoneFor({ city: "Phoenix, AZ", address: null })).toBe("America/Phoenix");
    expect(timezoneFor({ city: "Seattle, wa", address: null })).toBe("America/Los_Angeles");
    expect(timezoneFor({ city: "Edison", address: null })).toBe("America/New_York");
  });
});

describe("time zones", () => {
  it("converts wall-clock time both ways, across daylight saving", () => {
    expect(zonedToUtc("America/New_York", 2026, 12, 1, 9 * 60)!.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(zonedToUtc("America/New_York", 2026, 7, 1, 9 * 60)!.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(isoInZone("America/Chicago", new Date("2026-12-01T15:30:00Z"))).toBe("2026-12-01T09:30:00-06:00");
    // 2:30 am doesn't exist on the spring-forward day.
    expect(zonedToUtc("America/New_York", 2027, 3, 14, 2 * 60 + 30)).toBeNull();
    expect(bookingWhen("2026-12-01T09:30:00-05:00", "America/New_York")).toBe("Tue, Dec 1, 9:30 am");
  });
});

describe("parseLeadSettings", () => {
  const base = { bookingOn: "yes", svcName0: "Haircut", svcMin0: "30", svcPrice0: "$25", day1: "yes", day1s0: "09:00", day1e0: "17:00", timezone: "America/Chicago", leadHours: "4", daysAhead: "14" };
  it("reads services, weekly hours and limits", () => {
    const r = parseLeadSettings({ ...base, day3: "yes", day3s0: "09:00", day3e0: "12:00", day3s1: "13:00", day3e1: "18:00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.services).toEqual([{ name: "Haircut", durationMin: 30, price: "$25" }]);
    expect(r.booking.weekly[1]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(r.booking.weekly[3]).toHaveLength(2);
    expect(r.booking.weekly[0]).toEqual([]);
    expect(r.booking).toMatchObject({ on: true, timezone: "America/Chicago", leadHours: 4, daysAhead: 14 });
    expect(r.reviewLink).toBeNull();
  });
  it("refuses a booking setup with nothing to book, bad times or overlaps", () => {
    expect(parseLeadSettings({ bookingOn: "yes" })).toMatchObject({ ok: false, errors: { services: expect.any(String), weekly: expect.any(String) } });
    expect(parseLeadSettings({ ...base, day1e0: "08:00" })).toMatchObject({ ok: false, errors: { weekly: expect.any(String) } });
    expect(parseLeadSettings({ ...base, day1s1: "16:00", day1e1: "18:00" })).toMatchObject({ ok: false, errors: { weekly: expect.stringContaining("overlap") } });
    expect(parseLeadSettings({ ...base, svcMin0: "2" })).toMatchObject({ ok: false, errors: { services: expect.any(String) } });
    expect(parseLeadSettings({ ...base, svcName0: "www.evil.test" })).toMatchObject({ ok: false });
  });
  it("keeps unknown time zones and limits to safe defaults", () => {
    const r = parseLeadSettings({ ...base, timezone: "Europe/Paris", leadHours: "999", daysAhead: "365" });
    expect(r.ok && r.booking).toMatchObject({ timezone: "America/New_York", leadHours: 2, daysAhead: 30 });
  });
  it("reads the Google rating only as typed, both or neither", () => {
    expect(parseLeadSettings({ googleRating: "4.83", googleCount: "1,204" })).toMatchObject({ ok: true, googleRating: { rating: 4.8, count: 1204 } });
    expect(parseLeadSettings({ googleRating: "7" }).ok).toBe(false);
    expect(parseLeadSettings({ googleCount: "12" }).ok).toBe(false);
  });
});

describe("review links", () => {
  it("accepts Google's own links and a Place ID, nothing else", () => {
    expect(parseReviewLink("ChIJN1t_tDeuEmsRUsoyG83frY4")).toEqual({
      ok: true,
      url: "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
      placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    });
    expect(parseReviewLink("https://g.page/r/CbX123abc/review")).toMatchObject({ ok: true, url: "https://g.page/r/CbX123abc/review", placeId: null });
    expect(parseReviewLink("https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4")).toMatchObject({ ok: true, placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" });
    expect(parseReviewLink("")).toEqual({ ok: true, url: null, placeId: null });
    for (const bad of ["https://evil.test/review", "http://g.page/r/x", "https://g.page.evil.test/r", "javascript:alert(1)", "https://user:pw@g.page/r"]) {
      expect(parseReviewLink(bad).ok).toBe(false);
    }
  });
  it("uses the owner's link first, else AdVault's Place ID", () => {
    const base = { source: "advault" as const, billing: undefined };
    expect(reviewUrlFor({ ...base, reviewLink: "https://g.page/r/x/review", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" })).toBe("https://g.page/r/x/review");
    expect(reviewUrlFor({ ...base, reviewLink: null, placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" })).toContain("writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4");
    expect(reviewUrlFor({ ...base, reviewLink: null, placeId: "bad id!" })).toBeNull();
  });
});

describe("freeSlots", () => {
  // Monday 2026-11-30, 06:00 New York.
  const now = new Date("2026-11-30T11:00:00Z");
  const haircut = settings().services[0]!;
  it("offers starts inside the open hours, after the lead time, with the zone's offset", () => {
    const slots = freeSlots(settings(), haircut, "2026-11-30", now, []);
    // 06:00 + 2 h lead = from 08:00; opens 09:00; last 30-minute start 16:30.
    expect(slots[0]).toEqual({ start: "2026-11-30T09:00:00-05:00", label: "9:00 am" });
    expect(slots.at(-1)!.start).toBe("2026-11-30T16:30:00-05:00");
    expect(slots).toHaveLength(16);
    const later = freeSlots(settings({ leadHours: 4 }), haircut, "2026-11-30", new Date("2026-11-30T15:10:00Z"), []);
    expect(later[0]!.start).toBe("2026-11-30T14:30:00-05:00");
  });
  it("leaves out busy times, closed days and days outside the window", () => {
    const busy = [{ start: "2026-12-01T10:00:00-05:00", end: "2026-12-01T11:00:00-05:00" }];
    const starts = freeSlots(settings(), haircut, "2026-12-01", now, busy).map((s) => s.start.slice(11, 16));
    expect(starts).not.toContain("10:00");
    expect(starts).not.toContain("10:30");
    expect(starts).toContain("09:30");
    expect(starts).toContain("11:00");
    expect(freeSlots(settings(), haircut, "2026-12-05", now, [])).toEqual([]); // Saturday
    expect(freeSlots(settings({ daysAhead: 7 }), haircut, "2026-12-10", now, [])).toEqual([]);
    expect(freeSlots(settings(), haircut, "2026-11-29", now, [])).toEqual([]); // yesterday
    expect(freeSlots(settings(), haircut, "not-a-date", now, [])).toEqual([]);
  });
  it("fits the whole service before closing, 15-minute steps for short ones", () => {
    const long = { name: "Colour", durationMin: 120, price: null };
    expect(freeSlots(settings(), long, "2026-12-01", now, []).at(-1)!.label).toBe("3:00 pm");
    const short = { name: "Trim", durationMin: 15, price: null };
    expect(freeSlots(settings(), short, "2026-12-01", now, []).slice(0, 2).map((s) => s.label)).toEqual(["9:00 am", "9:15 am"]);
  });
  it("handles the daylight-saving change and other zones", () => {
    const sunday = settings({ weekly: [[{ start: "01:00", end: "05:00" }], [], [], [], [], [], []], leadHours: 0, daysAhead: 90 });
    const dst = freeSlots(sunday, { name: "x", durationMin: 60, price: null }, "2027-03-14", new Date("2027-03-01T00:00:00Z"), []);
    // 2:00-2:59 doesn't exist that night; offsets switch from -05:00 to -04:00.
    expect(dst.map((s) => s.start)).toEqual(["2027-03-14T01:00:00-05:00", "2027-03-14T01:30:00-05:00", "2027-03-14T03:00:00-04:00", "2027-03-14T03:30:00-04:00", "2027-03-14T04:00:00-04:00"]);
    const la = freeSlots(settings({ timezone: "America/Los_Angeles" }), haircut, "2026-12-01", now, []);
    expect(la[0]!.start).toBe("2026-12-01T09:00:00-08:00");
  });
  it("lists only days with a free time", () => {
    const days = openDates(settings({ daysAhead: 7 }), haircut, now, []);
    expect(days.map((d) => d.label)).toEqual(["Mon, Nov 30", "Tue, Dec 1", "Wed, Dec 2", "Thu, Dec 3", "Fri, Dec 4"]);
  });
});

describe("parseLeadInput", () => {
  it("needs a name and phone; email only for bookings", () => {
    expect(parseLeadInput("quote", { name: "Ann", phone: "(555) 201-0000", message: "Fix my fence" })).toEqual({ ok: true, value: { name: "Ann", phone: "(555) 201-0000", message: "Fix my fence" } });
    expect(parseLeadInput("quote", { name: "", phone: "12" })).toMatchObject({ ok: false, errors: { name: expect.any(String), phone: expect.any(String) } });
    expect(parseLeadInput("booking", { name: "Ann", phone: "5552010000" })).toMatchObject({ ok: false, errors: { email: expect.any(String) } });
    expect(parseLeadInput("booking", { name: "Ann", phone: "5552010000", email: "ANN@Example.com" })).toMatchObject({ ok: true, value: { email: "ann@example.com" } });
    expect(parseLeadInput("callback", { name: "Ann", phone: "5552010000", bestTime: "After 5" })).toMatchObject({ ok: true, value: { bestTime: "After 5" } });
    expect(parseLeadInput("quote", { name: "Ann", phone: "5552010000", bestTime: "After 5" })).toEqual({ ok: true, value: { name: "Ann", phone: "5552010000" } });
  });
});

describe("lead source", () => {
  it("reads the referrer's host (not our own) and utm tags, cleaned", () => {
    const page = new URL("https://green.3pandasite.test/?utm_source=youtube&utm_campaign=Spring%20ad");
    expect(sourceFromRequest(page, "https://www.youtube.com/watch?v=abc")).toEqual({ referrerHost: "www.youtube.com", utmSource: "youtube", utmCampaign: "Spring ad" });
    expect(sourceFromRequest(new URL("https://green.3pandasite.test/"), "https://green.3pandasite.test/book")).toEqual({});
    expect(sourceFromFields({ src_ref: "Evil<script>", src_us: "x\"><", src_uc: "ok" })).toEqual({ utmCampaign: "ok" });
  });
});

describe("qr", () => {
  it("sizes the code to the text and draws the three finder patterns", () => {
    const m = qrMatrix("https://green-lawns.3pandasite.com/review")!;
    expect(m.length).toBe(29); // version 3 (41 bytes)
    for (const [x, y] of [[0, 0], [m.length - 7, 0], [0, m.length - 7]] as const) {
      expect(m[y]![x]).toBe(true);
      expect(m[y + 1]![x + 1]).toBe(false);
      expect(m[y + 3]![x + 3]).toBe(true);
    }
    expect(qrMatrix("x".repeat(300))).toBeNull();
  });
  it("makes a self-contained SVG", () => {
    const svg = qrSvg("https://a.3pandasite.com/review", { title: "QR <code>" })!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("&#60;code&#62;");
    expect(svg).not.toMatch(/href|<script/);
  });
});
