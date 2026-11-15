// Stripe over plain fetch (no SDK): Checkout, the billing portal, cancelling a
// replaced subscription, and webhook signature checks. The Stripe account is
// shared with other 3PandaLabs apps, so everything we create is tagged
// metadata.app = "sitevault" and the webhook ignores anything else.

const API = "https://api.stripe.com/v1";

async function call(key: string, method: "POST" | "DELETE", path: string, params: [string, string][]): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error ?? {}) as { message?: string; type?: string };
    throw new Error(`stripe ${method} ${path} ${res.status}: ${err.type ?? ""} ${err.message ?? ""}`.trim());
  }
  return data;
}

/** Create a Checkout Session; returns its hosted URL. */
export async function createCheckoutSession(key: string, params: [string, string][]): Promise<string> {
  const s = await call(key, "POST", "/checkout/sessions", params);
  if (typeof s.url !== "string") throw new Error("stripe checkout session has no url");
  return s.url;
}

/** Billing portal for an existing customer; returns its URL. */
export async function createPortalSession(key: string, customer: string, returnUrl: string): Promise<string> {
  const s = await call(key, "POST", "/billing_portal/sessions", [
    ["customer", customer],
    ["return_url", returnUrl],
  ]);
  if (typeof s.url !== "string") throw new Error("stripe portal session has no url");
  return s.url;
}

/** Cancel a replaced subscription now; unused time becomes customer balance credit. */
export async function cancelSubscription(key: string, id: string): Promise<void> {
  await call(key, "DELETE", `/subscriptions/${encodeURIComponent(id)}`, [
    ["prorate", "true"],
    ["invoice_now", "true"],
  ]);
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(payload));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Stripe-Signature: "t=<unix>,v1=<hex>[,v1=<hex>...]". The signed payload is
 * `${t}.${rawBody}`, HMAC-SHA256 with the endpoint's signing secret. Rejects
 * timestamps more than `toleranceSec` from now (replay protection).
 */
export async function verifyStripeSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  nowSec: number,
  toleranceSec = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1") sigs.push(v);
  }
  if (t === null || sigs.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  let ok = false;
  for (const s of sigs) ok = constantTimeEqual(s, expected) || ok;
  return ok;
}
