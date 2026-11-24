// The panda helper's and /faq's answers, and the plain word matching that picks
// one (ported from AdVault web/src/lib/help/match.ts; keep them alike). No AI:
// it can only show text written here. Prices come from billing.ts, so they
// change with it; keep the rest true when a screen or rule changes.
import { MAX_RENAMES } from "./address.js";
import { ADVAULT_INCLUDED_DAYS, DOLLARS, GRACE_DAYS, PACK_CREDITS, START_CREDITS, endOf, festiveOpen, type BillingConfig } from "./billing.js";
import { MAX_PHOTOS } from "./site.js";

export type HelpTopic = {
  id: string;
  q: string;
  a: string;
  /** Words that point at this topic. A "two words" entry needs both and counts double. */
  keys: string[];
  links?: { label: string; href: string }[];
  /** Also listed on /faq. */
  faq?: boolean;
};

/** Offered before anything is typed. */
export const STARTERS = ["price", "edit", "plans", "lapse", "address"];

const MINE = { label: "My website", href: "/account" };
const BUILD = { label: "Build my website", href: "/new" };
const fmt = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export function helpTopics(cfg: BillingConfig, now: Date): HelpTopic[] {
  const festive = cfg.on && festiveOpen(cfg, now) ? fmt(endOf(cfg.festiveUntil!)) : null;
  const price = !cfg.on
    ? "SiteVault is free during early access."
    : festive
      ? `Building is free; you pay when you publish. Festive season price: Basic $${DOLLARS.festive} a year or Pro $${DOLLARS.festivePro} a year, locked for life if you pay by ${festive}. After that, Basic is $${DOLLARS.basic} a year and Pro is $${DOLLARS.pro} a year. Plans renew each year until you cancel.`
      : `Building is free; you pay when you publish. Basic is $${DOLLARS.basic} a year and Pro is $${DOLLARS.pro} a year. Plans renew each year until you cancel.`;
  return [
    {
      id: "price",
      faq: true,
      q: "How much does a website cost?",
      a: price,
      keys: ["price", "pricing", "cost", "fee", "charge", "how much", "expensive", "cheap", "free", "year pay", "month pay", "festive", "publish cost", "pay publish", "calculated"],
      links: [{ label: "Compare plans", href: "/#plans" }],
    },
    {
      id: "plans",
      faq: true,
      q: "What is the difference between Basic and Pro?",
      a: "Both keep your website online with hosting, a web address, secure HTTPS and editing. Pro adds visitor stats: visits by day, where visitors found you, their towns and devices, and how many tapped Call or Directions. You can upgrade to Pro anytime.",
      keys: ["basic", "pro", "basic pro", "difference", "compare", "upgrade", "plans", "which plan"],
      links: [{ label: "Compare plans", href: "/#plans" }],
    },
    {
      id: "start",
      faq: true,
      q: "How do I make my website?",
      a: "Press Build my website and fill in your business name, phone, what you offer, where you work and your hours, then add photos. You see a preview before anything goes live.",
      keys: ["start", "begin", "make website", "build", "build website", "create website", "new website", "how work", "get started", "sign up", "signup", "register", "create account", "preview"],
      links: [BUILD],
    },
    {
      id: "edit",
      faq: true,
      q: "Can I change my website later?",
      a: "Yes, anytime and from your phone. Sign in, open My website and press Edit your website. You can change the text, photos, hours and style. Editing is included; only a new current special uses an offer credit.",
      keys: ["edit", "change website", "edit website", "update", "update website", "change text", "change hours", "change photo", "change style", "design", "template", "colour", "color", "change phone", "later"],
      links: [MINE],
    },
    {
      id: "address",
      faq: true,
      q: "What web address do I get?",
      a: `You pick yourname.3pandasite.com, included with your plan. You can change it up to ${MAX_RENAMES} times, and the old address keeps sending visitors to the new one. Using a domain you own isn't available yet.`,
      keys: ["address", "web address", "domain", "own domain", "url", "link", "rename", "change address", "custom domain", "3pandasite", "dot com"],
      links: [MINE],
    },
    {
      id: "photos",
      q: "How many photos can I add?",
      a: `Up to ${MAX_PHOTOS} photos. They are resized for the web for you.`,
      keys: ["photo", "photos", "picture", "image", "how many photo", "upload photo", "gallery"],
      links: [MINE],
    },
    {
      id: "offer",
      faq: true,
      q: "What are offer credits?",
      a: `Putting a new current special on your website uses 1 credit; clearing it is free. Every website starts with ${START_CREDITS} credits, and ${PACK_CREDITS} more cost $${DOLLARS.pack}.`,
      keys: ["offer", "credit", "special", "discount", "promotion", "coupon", "deal", "offer credit", "current special"],
      links: [MINE],
    },
    {
      id: "stats",
      q: "Where do I see my visitors?",
      a: "Sign in, open My website and choose Visitors stats, or the Stats tab when editing. Basic shows your visits for the last 30 days; Pro shows where they came from, their towns and devices, and taps on Call and Directions.",
      keys: ["stats", "statistics", "visitor", "visit", "traffic", "analytics", "how many people", "who visited", "views"],
      links: [MINE],
    },
    {
      id: "reviews",
      q: "Can customers leave reviews?",
      a: "Yes. A review a visitor leaves on your website waits for you, and shows only after you approve it on your edit page. You can remove it later.",
      keys: ["review", "testimonial", "rating", "feedback customer", "approve review"],
      links: [MINE],
    },
    {
      id: "cancel",
      faq: true,
      q: "How do I cancel?",
      a: "Open your website's edit page, go to Plan & billing and press Manage billing to stop the next renewal. Your website stays up until the end of the year you paid for.",
      keys: ["cancel", "stop renew", "renew", "cancel plan", "unsubscribe", "manage billing", "contract", "commitment", "billing", "change card"],
      links: [MINE],
    },
    {
      id: "lapse",
      faq: true,
      q: "What happens if I stop paying?",
      a: `Your website stays online for ${GRACE_DAYS} days after the paid period ends. Then it shows a paused page with your business name and phone number. Nothing is deleted, and paying brings it back.`,
      keys: ["stop pay", "stop paying", "not paying", "dont pay", "expire", "expired", "paused", "overdue", "unpaid", "late payment", "lapse", "offline"],
      links: [MINE],
    },
    {
      id: "advault",
      faq: true,
      q: "I have an AdVault plan. Do I pay for the website too?",
      a: `A website made from AdVault is $${DOLLARS.advaultSetup} once, paid in AdVault, with the first ${ADVAULT_INCLUDED_DAYS === 365 ? "year" : `${ADVAULT_INCLUDED_DAYS} days`} of Pro included. Pro also stays included while your AdVault monthly plan runs. Otherwise it is $${DOLLARS.proAdvault} a year after that. A website made on SiteVault has its own yearly plan.`,
      keys: ["advault", "advault plan", "advault website", "already pay", "pay twice", "included advault"],
      links: [{ label: "Go to AdVault", href: "https://advault.3pandalabs.com" }],
    },
    {
      id: "ads",
      q: "Can I get a video ad for my business?",
      a: `Yes, with AdVault, our video-ad app. It makes a YouTube ad from your photos for $${DOLLARS.advaultAd} and shows it to people nearby; the ad budget is separate. The same email and password sign you in.`,
      keys: ["video", "video ad", "youtube", "advertise", "advertising", "ads", "ad", "promote", "more customers", "marketing"],
      links: [{ label: "See AdVault", href: "https://advault.3pandalabs.com" }],
    },
    {
      id: "many",
      faq: true,
      q: "Can I have more than one website?",
      a: "It's one website per account and per business phone number. For another business, sign out and create a new account for it.",
      keys: ["more than one", "two website", "second website", "another website", "another business", "multiple", "several website"],
    },
    {
      id: "login",
      q: "I can't sign in or lost my edit link",
      a: "Use Forgot password and we'll email you a link. SiteVault and AdVault share one login. If you only have an old edit link and lost it, send us a message with your web address.",
      keys: ["password", "login", "log in", "sign in", "signin", "forgot", "reset password", "locked", "lost link", "edit link", "lost edit"],
      links: [{ label: "Forgot password", href: "/forgot-password" }, { label: "Sign in", href: "/login" }],
    },
    {
      id: "remove",
      faq: true,
      q: "How do I take my website down?",
      a: "Send us a message with your web address. We confirm with you at the phone number on the website, cancel its renewal, take it offline and delete its photos.",
      keys: ["take down", "remove website", "delete website", "unpublish", "shut down", "close website"],
      links: [{ label: "Contact us", href: "/contact" }],
    },
    {
      id: "delete",
      q: "How do I delete my account?",
      a: "Sign in, open My website and press Delete my account. Your login is shared with AdVault, so this ends it on both. The website itself is removed separately: send us a message with its address.",
      keys: ["delete account", "close account", "remove account", "delete data", "delete"],
      links: [MINE, { label: "What is deleted", href: "/privacy#delete-account" }],
    },
    {
      id: "privacy",
      q: "Does my website use cookies or trackers?",
      a: "No. Websites we make set no cookies and have no trackers. Visits are counted on our side in totals only.",
      keys: ["cookie", "tracker", "privacy", "data safe", "gdpr", "secure", "https"],
      links: [{ label: "Privacy", href: "/privacy" }],
    },
  ];
}

const STOP = new Set(
  "a an the i im ive my me we our you your is are am be do does did can could will would should how what when where which who why to of for on in at it its this that and or with if from by as so please need want have has there any some get about help hi hello hey tell know not no".split(" "),
);

/** "targeting" -> "target", "prices" -> "price": crude, but the same on both sides. */
function stem(w: string): string {
  for (const end of ["ing", "ed", "es", "s"]) if (w.length - end.length >= 4 && w.endsWith(end)) return w.slice(0, -end.length).replace(/e$/, "");
  return w.replace(/e$/, "");
}

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .split(/[^a-z0-9$]+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

/** Edit distance counting a swap of neighbours as one, capped at 3. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  return Math.min(3, d[a.length]![b.length]!);
}

/** How alike two stemmed words are: 1 the same, less for a likely typo, 0 different. */
function alike(typed: string, key: string): number {
  if (typed === key) return 1;
  const n = Math.min(typed.length, key.length);
  if (n < 5 || typed[0] !== key[0]) return 0;
  const d = distance(typed, key);
  if (d === 1) return 0.8;
  if (n >= 7 && d === 2) return 0.7;
  // Scrambled letters ("aiduince" for "audience").
  if (n >= 7 && typed.length === key.length && typed.at(-1) === key.at(-1)) {
    const left = [...key];
    for (const ch of typed) {
      const i = left.indexOf(ch);
      if (i >= 0) left.splice(i, 1);
    }
    if (left.length <= 1) return 0.7;
  }
  return 0;
}

// A word the helper already knows is never a typo of another ("change" is not "charge").
const best = (typed: string[], key: string, known: Set<string>) =>
  typed.reduce((m, w) => Math.max(m, known.has(w) ? (w === key ? 1 : 0) : alike(w, key)), 0);

/** Topics for a question, best first; empty when nothing fits well enough. */
export function matchTopics(question: string, topics: HelpTopic[]): HelpTopic[] {
  const typed = words(question);
  if (!typed.length) return [];
  const known = new Set(topics.flatMap((t) => t.keys.flatMap(words)));
  return topics
    .map((t) => {
      let score = 0;
      for (const key of t.keys) {
        const parts = words(key);
        const hits = parts.map((p) => best(typed, p, known));
        if (parts.length && hits.every((h) => h > 0)) score += (hits.reduce((x, y) => x + y, 0) / hits.length) * (parts.length > 1 ? 2.5 : 1);
      }
      return { t, score };
    })
    .filter((x) => x.score >= 0.7)
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)
    .map((x) => x.t);
}
