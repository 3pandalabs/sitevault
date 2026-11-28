// AdVault keeps the leads (quotes, call-backs, bookings) and sends every email
// about them: it holds the mailer token, and the owner may also see them in
// AdVault's dashboard. These are SiteVault's calls to it, bearer INTERNAL_TOKEN
// to ADVAULT_API_URL like every other /internal/sitevault/* call
// (accounts.ts). 8 s timeout; they never throw: null = AdVault unreachable,
// unconfigured or not deployed yet, and the caller shows a friendly fallback.

import type { AdvaultApi } from "./accounts.js";
import type { Busy, LeadKind, LeadSource, LeadStatus } from "./leads.js";

type Reply = { status: number; body: Record<string, unknown> };

async function call(api: AdvaultApi, method: "GET" | "POST", path: string, body?: unknown): Promise<Reply | null> {
  if (!api.apiUrl || !api.token) return null;
  try {
    const res = await fetch(`${api.apiUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${api.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text().catch(() => "");
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown> };
  } catch (err) {
    console.warn("advault leads call failed", path, String(err));
    return null;
  }
}

/** Who owns the site, when SiteVault knows (saves AdVault a round trip to account-site). */
export type LeadOwner = { advaultUserId?: string; email?: string };

export type NewLead = {
  slug: string;
  kind: LeadKind;
  name: string;
  phone: string;
  email?: string;
  message?: string;
  bestTime?: string;
  photoUrls?: string[];
  booking?: { service: string; durationMin: number; start: string; timezone: string };
  source?: LeadSource;
  idempotencyKey: string;
  ownerEmail?: string;
  advaultUserId?: string;
};

/** POST /internal/sitevault/leads. */
export async function postLead(api: AdvaultApi, lead: NewLead): Promise<{ ok: true; leadId: string } | { ok: false; reason: "slot_taken" | "invalid" | "unavailable" }> {
  const r = await call(api, "POST", "/internal/sitevault/leads", lead);
  if (r && (r.status === 201 || r.status === 200)) return { ok: true, leadId: typeof r.body.leadId === "string" ? r.body.leadId : "" };
  if (r?.status === 409 && r.body.error === "slot_taken") return { ok: false, reason: "slot_taken" };
  if (r) console.warn("advault lead refused", { status: r.status, error: r.body.error, kind: lead.kind });
  return { ok: false, reason: r?.status === 400 ? "invalid" : "unavailable" };
}

/** GET /internal/sitevault/leads/busy: requested + confirmed bookings. null = couldn't ask. */
export async function getBusy(api: AdvaultApi, slug: string, from: string, to: string): Promise<Busy[] | null> {
  const q = new URLSearchParams({ slug, from, to });
  const r = await call(api, "GET", `/internal/sitevault/leads/busy?${q}`);
  if (r?.status !== 200 || !Array.isArray(r.body.busy)) return null;
  return (r.body.busy as unknown[]).filter(
    (b): b is Busy => Boolean(b) && typeof (b as Busy).start === "string" && typeof (b as Busy).end === "string",
  );
}

export type Lead = {
  id: string;
  kind: LeadKind;
  status: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  bestTime: string | null;
  photoUrls: string[];
  booking: { service: string; durationMin: number; start: string; timezone: string } | null;
  source: LeadSource | null;
  createdAt: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** GET /internal/sitevault/leads for one site. null = couldn't load. */
export async function listLeads(api: AdvaultApi, slug: string, owner: LeadOwner): Promise<Lead[] | null> {
  const q = new URLSearchParams({ slug });
  if (owner.advaultUserId) q.set("advaultUserId", owner.advaultUserId);
  if (owner.email) q.set("email", owner.email);
  const r = await call(api, "GET", `/internal/sitevault/leads?${q}`);
  if (r?.status !== 200 || !Array.isArray(r.body.leads)) return null;
  return (r.body.leads as Record<string, unknown>[])
    .filter((l) => l && typeof l.id === "string")
    .map((l) => {
      const b = l.booking as Record<string, unknown> | null | undefined;
      return {
        id: l.id as string,
        kind: (["quote", "callback", "booking"].includes(l.kind as string) ? l.kind : "quote") as LeadKind,
        status: str(l.status) ?? "new",
        name: str(l.name) ?? "",
        phone: str(l.phone) ?? "",
        email: str(l.email),
        message: str(l.message),
        bestTime: str(l.bestTime),
        photoUrls: Array.isArray(l.photoUrls) ? (l.photoUrls as unknown[]).filter((u): u is string => typeof u === "string") : [],
        booking:
          b && typeof b.start === "string"
            ? { service: str(b.service) ?? "", durationMin: Number(b.durationMin) || 0, start: b.start, timezone: str(b.timezone) ?? "America/New_York" }
            : null,
        source: (l.source && typeof l.source === "object" ? l.source : null) as LeadSource | null,
        createdAt: str(l.createdAt) ?? "",
      };
    });
}

/** POST /internal/sitevault/leads/:id/status. AdVault emails the customer on confirmed/declined bookings. */
export async function setLeadStatus(api: AdvaultApi, id: string, status: LeadStatus, owner: LeadOwner): Promise<boolean> {
  const r = await call(api, "POST", `/internal/sitevault/leads/${encodeURIComponent(id)}/status`, { status, ...owner });
  return r?.status === 204 || r?.status === 200;
}

/** POST /internal/sitevault/leads/:id/review-request. "already" = AdVault asked this customer before (once per lead). */
export async function requestReview(api: AdvaultApi, id: string, reviewUrl: string, owner: LeadOwner): Promise<"ok" | "already" | "error"> {
  const r = await call(api, "POST", `/internal/sitevault/leads/${encodeURIComponent(id)}/review-request`, { reviewUrl, ...owner });
  if (r?.status === 204 || r?.status === 200) return "ok";
  if (r?.status === 409) return "already";
  return "error";
}
