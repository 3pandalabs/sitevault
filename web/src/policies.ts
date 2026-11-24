// The legal/policy pages every customer site carries: Privacy Policy,
// Cookies Policy, Accessibility Statement and Terms of Service. Each is
// prepopulated from the business's own details and is editable by the owner on
// the edit page. We store only the owner's OVERRIDE (site.policies[kind]); when
// there is none, the default is generated here at render time, so it stays
// current as the business changes and improves with the templates.
//
// The copy is deliberately ACCURATE to how SiteVault customer sites actually
// work: no cookies, no advertising pixels, no third-party trackers, and only
// anonymous aggregate visit counts (render.ts / stats.ts). A boilerplate
// cookies policy listing analytics and ad cookies would be false here and would
// undercut the whole privacy promise. These are plain-language starters, not
// legal advice — the edit page says so.

import { type PolicyKind, type Site } from "./site.js";
import { esc } from "./util.js";

export const POLICY_KINDS: PolicyKind[] = ["privacy", "accessibility", "cookies", "terms"];

export const POLICY_META: Record<PolicyKind, { path: string; title: string; navLabel: string }> = {
  privacy: { path: "/privacy", title: "Privacy Policy", navLabel: "Privacy" },
  accessibility: { path: "/accessibility", title: "Accessibility Statement", navLabel: "Accessibility" },
  cookies: { path: "/cookies", title: "Cookies Policy", navLabel: "Cookies" },
  terms: { path: "/terms", title: "Terms of Service", navLabel: "Terms" },
};

/** The policy page a customer-host path maps to, or null. */
export function policyPathKind(path: string): PolicyKind | null {
  for (const k of POLICY_KINDS) if (POLICY_META[k].path === path) return k;
  return null;
}

/** The business facts the default policy copy is built from. */
type PolicyData = {
  name: string;
  url: string;
  phone: string;
  email: string | null;
  address: string | null;
  hours: string | null;
};

export function policyData(site: Site, url: string): PolicyData {
  const where = [site.address, site.city].filter(Boolean).join(", ");
  return {
    name: site.businessName,
    url,
    phone: site.phone,
    email: site.email,
    address: where || null,
    hours: site.hours,
  };
}

/** Markdown bullet list of the ways to reach the business. Phone is always present. */
function contactBlock(d: PolicyData): string {
  const lines = [`- **Phone:** ${d.phone}`];
  if (d.email) lines.push(`- **Email:** ${d.email}`);
  if (d.address) lines.push(`- **Address:** ${d.address}`);
  if (d.hours) lines.push(`- **Hours:** ${d.hours.replace(/\n+/g, "; ")}`);
  return lines.join("\n");
}

/**
 * The default copy for one policy page, as the same light markdown the owner
 * edits (## headings, - bullets, **bold**). No literal "effective date" is baked
 * in: the page chrome shows a real "Last updated" line, so the body stays stable
 * across saves (which matters — see parsePolicies in site.ts).
 */
export function policyDefault(kind: PolicyKind, d: PolicyData): string {
  const contact = contactBlock(d);
  switch (kind) {
    case "privacy":
      return `## Who we are
${d.name} operates this website at ${d.url}. This Privacy Policy explains what information we collect through this site and how we use it.

## Information we collect
- **Information you share with us.** This website has no contact or booking forms. You reach us directly by phone${d.email ? ", by email," : ""} or in person, and anything you choose to tell us that way is used only to respond to you.
- **Anonymous visit counts.** We keep simple, aggregate counts of page views and taps on the Call and Directions buttons, so we can see how many people the site reaches. When you arrive from another website, we also record the name of that website (its domain, such as a search engine or social network) — never the full web address you came from. These counts do not identify you: we do not store your name, your IP address, or your browsing history, and we do not use cookies or trackers to collect them.

## Cookies and tracking
This website does not use cookies, advertising pixels, or third-party trackers. See our Cookies Policy for more.

## How we use information
We use the limited information above to respond to your enquiries, to run and improve this website, and to meet our legal obligations.

## Sharing
We do not sell your personal information and we do not share it with advertisers. This website is hosted by our website provider, 3PandaLabs (SiteVault), which handles the anonymous visit counts on our behalf. We may disclose information only where the law requires it.

## Your choices and rights
Depending on where you live, you may have the right to ask what information we hold about you, to correct it, or to ask us to delete it. Because this site collects so little, there is usually very little to act on. To make a request, contact us using the details below.

## Children's privacy
This website is for a general audience and is not directed to children under 13. We do not knowingly collect information from children.

## Changes
We may update this Privacy Policy from time to time. The date at the top of this page shows when it last changed.

## Contact us
Questions about this policy? Contact ${d.name}:
${contact}`;

    case "cookies":
      return `## Our approach to cookies
${d.name} is committed to protecting your privacy. This website does not set cookies on your device, and it does not use advertising pixels, analytics cookies, or third-party trackers.

## What this means for you
- No cookie banner is needed, because there are no non-essential cookies to accept or decline.
- We do not track you across other websites.
- We do not build a profile of you, and we do not sell your data.

## How we count visits
So we can tell roughly how many people the site reaches, we keep simple aggregate counts of page views and taps on the Call and Directions buttons. These counts are anonymous: they are gathered without cookies and do not store your name, your IP address, or any identifier that singles you out.

## Links to other services
Our site may link out — for example to a map or your phone's dialer. If you follow a link to another company's website, that company's own cookie and privacy practices apply, and we'd encourage you to review them.

## Changes
If we ever add a feature that uses cookies, we will update this page first and explain what it does. The date at the top shows when this page last changed.

## Contact us
Questions about cookies on this site? Contact ${d.name}:
${contact}`;

    case "accessibility":
      return `## Our commitment
${d.name} is committed to making this website, ${d.url}, accessible to as many people as possible, including people with disabilities. We want everyone to be able to find our information and get in touch with us easily.

## Conformance status
The Web Content Accessibility Guidelines (WCAG) define how to make web content more accessible, across three levels: A, AA, and AAA. This website aims to meet WCAG 2.1 Level AA where reasonably achievable. It is built with semantic headings, descriptive text for meaningful images, clear colour contrast, visible keyboard focus, and buttons and links large enough to tap easily. Some content may not yet fully conform, and we treat any barrier we learn about as something to fix.

## What we do
- Use clear, consistent navigation and plain language
- Provide text alternatives for images that carry meaning
- Aim for strong colour contrast and full keyboard operation
- Avoid anything that only works with a mouse

## Feedback
We welcome your feedback. If you have trouble using any part of this website, or you need information from it in a different format, please tell us and we will do our best to help:
${contact}

When you contact us, it helps to describe the page you were on and what you were trying to do.`;

    case "terms":
      return `## Agreement
This website at ${d.url} is operated by ${d.name} ("we," "us," or "our"). By using this website, you agree to these Terms of Service. If you do not agree, please do not use the site.

## About this website
This website provides general information about our business — the services we offer, our hours, and how to reach us. We try to keep it accurate and current, but we do not promise that every detail is complete or up to date. Prices, offers, and availability can change. For anything important — a quote, an appointment, or current pricing — please contact us directly.

## Using this website
You agree to use this website only for lawful purposes. You may not try to disrupt or misuse the site, or use it in any way that could harm us or other visitors.

## Intellectual property
The content on this website — text, images, and our business name and logo — belongs to ${d.name} or is used with permission. Please do not copy or reuse it without our consent.

## Offers and pricing
Any special offer shown on this site is subject to its own terms and may be changed or withdrawn at any time. An offer is not a binding contract until we confirm it with you directly.

## Limitation of liability
This website is provided "as is." To the fullest extent permitted by law, we are not liable for any loss arising from your use of, or reliance on, this website. Nothing here limits any rights you have that cannot be limited by law.

## Links
Our site may link to other services, such as a map or your phone's dialer. We are not responsible for the content or practices of websites we do not operate.

## Changes
We may update these Terms from time to time. The date at the top of this page shows when they last changed, and continuing to use the site means you accept the current version.

## Contact us
Questions about these Terms? Contact ${d.name}:
${contact}`;
  }
}

/** The text actually shown for a page: the owner's override, else the default. */
export function policyBody(site: Site, kind: PolicyKind, url: string): string {
  return site.policies?.[kind] ?? policyDefault(kind, policyData(site, url));
}

/** Bold runs inside a line, over already-escaped text. */
function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Render the light policy markdown (## headings, - bullets, **bold**,
 * paragraphs) to safe HTML. Every character is escaped first, so a URL an owner
 * types stays plain text — it never becomes a clickable anchor. That keeps the
 * "no links in free text" anti-phishing rule intact even though owners can edit
 * these pages freely.
 */
export function renderPolicyMarkup(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let list: string[] | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("## ") || line.startsWith("# ")) {
      flushPara();
      flushList();
      out.push(`<h2>${inline(line.replace(/^#+\s+/, ""))}</h2>`);
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      (list ??= []).push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join("\n");
}
