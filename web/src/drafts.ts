// AdVault create mode: the pre-fill "draft" (2026-11-19).
//
// AdVault's "Make me a website" frames SiteVault's FULL builder, pre-filled
// from the campaign. The pre-fill (text plus the ad's photos, before & after
// pairs and an own video) is too big for a URL token, and AdVault's photos sit
// in AdVault's private R2. So AdVault POSTs it here first, server to server
// (`POST /api/internal/drafts`, bearer INTERNAL_TOKEN), and gets a random
// draft id back; the signed create token (embed.ts) carries only that id.
// The browser never carries the data and cannot change what AdVault sent: the
// builder shows the draft's photos and the owner can only keep or drop them.
//
// Stored in R2, NOT KV: AdVault writes the draft from its server's nearest
// Cloudflare location and the owner's browser reads it a second later from
// theirs. KV can take up to 60 s to show a write elsewhere; R2 is strongly
// consistent. The same goes for the result AdVault reads back after create.
//
//   drafts/<id>/draft.json   this record
//   drafts/<id>/<rand>.<ext> its photos (web-sized), pair photos, video
//
// A draft lives DRAFT_TTL_MS (checked in code). Media files are deleted when a
// site is made from the draft (they're copied to sites/<slug>/ by the normal
// create path); an abandoned draft is left for the R2 lifecycle rule on the
// `drafts/` prefix (1 day) to sweep. draft.json keeps the create result
// (including the edit link, which AdVault stores encrypted, as with internal
// create) until that sweep; it is never served to a browser.

export const DRAFT_TTL_MS = 60 * 60 * 1000;

/** The text fields AdVault may pre-fill (all checked again on submit, like any builder input). */
export const DRAFT_PREFILL_FIELDS = ["businessName", "category", "phone", "city", "offer", "services", "tagline", "serviceArea", "hours", "about"] as const;
const PREFILL_MAX = 2000;

export type DraftFile = { key: string; type: string };

export type Draft = {
  v: 1;
  id: string;
  /** The AdVault user (shared 3PandaLabs account) this draft is for. */
  uid: string;
  email: string;
  campaignId: string;
  /** AdVault charges the $10 first: the site is made pending. */
  pay: boolean;
  /** An AdVault admin's test site (ownerAdmin=1): no one-per-account / one-per-phone. */
  admin: boolean;
  prefill: Partial<Record<(typeof DRAFT_PREFILL_FIELDS)[number], string>>;
  photos: DraftFile[];
  pairs: { before: DraftFile; after: DraftFile }[];
  video: DraftFile | null;
  /** Google Place ID from AdVault's Maps prefill (optional): becomes site.placeId. */
  placeId?: string;
  createdAt: string;
  /** ms epoch; refused after this. */
  exp: number;
  /** The SiteVault account the handoff signed in (set by GET /embed/new?token=). */
  accountId?: string;
  /** Set once a site is made from this draft (one site per draft). */
  result?: { slug: string; siteUrl: string; editUrl: string; pending: boolean };
};

const draftKey = (id: string) => `drafts/${id}/draft.json`;

export function draftPrefill(fields: Record<string, string>): Draft["prefill"] {
  const out: Draft["prefill"] = {};
  for (const k of DRAFT_PREFILL_FIELDS) {
    const v = (fields[k] ?? "").trim();
    if (v) out[k] = v.slice(0, PREFILL_MAX);
  }
  return out;
}

export async function loadDraft(bucket: R2Bucket, id: string): Promise<Draft | null> {
  const obj = await bucket.get(draftKey(id));
  if (!obj || !("text" in obj)) return null;
  try {
    const d = JSON.parse(await (obj as R2ObjectBody).text()) as Draft;
    return d?.v === 1 && d.id === id ? d : null;
  } catch {
    return null;
  }
}

export async function saveDraft(bucket: R2Bucket, d: Draft): Promise<void> {
  await bucket.put(draftKey(d.id), JSON.stringify(d), { httpMetadata: { contentType: "application/json" } });
}

/** Every media key of a draft (for the session-gated preview route and cleanup). */
export function draftFileKeys(d: Draft): string[] {
  return [...d.photos.map((p) => p.key), ...d.pairs.flatMap((p) => [p.before.key, p.after.key]), ...(d.video ? [d.video.key] : [])];
}

export function draftExpired(d: Draft, nowMs = Date.now()): boolean {
  return nowMs >= d.exp;
}
