import { describe, expect, it } from "vitest";
import { hmacSha256Hex, verifyStripeSignature } from "../src/stripe.js";

const SECRET = "whsec_test_secret";
const BODY = '{"id":"evt_1","type":"invoice.paid"}';
const T = 1700000000;
// HMAC-SHA256(SECRET, `${T}.${BODY}`), computed once with Node's crypto.createHmac and pinned.
const VECTOR = "46dc069361a7691082640523fa33fe5d6c8c88d5f5e257cdf8cf11539d166595";

describe("hmacSha256Hex", () => {
  it("matches the pinned vector", async () => {
    expect(await hmacSha256Hex(SECRET, `${T}.${BODY}`)).toBe(VECTOR);
  });
  it("matches RFC 4231 test case 2", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
});

describe("verifyStripeSignature", () => {
  const header = `t=${T},v1=${VECTOR}`;

  it("accepts a valid signature within tolerance", async () => {
    expect(await verifyStripeSignature(header, BODY, SECRET, T)).toBe(true);
    expect(await verifyStripeSignature(header, BODY, SECRET, T + 300)).toBe(true);
    expect(await verifyStripeSignature(header, BODY, SECRET, T - 300)).toBe(true);
  });

  it("accepts when any of several v1 signatures matches (secret rotation)", async () => {
    expect(await verifyStripeSignature(`t=${T},v1=${"0".repeat(64)},v1=${VECTOR},v0=abc`, BODY, SECRET, T)).toBe(true);
  });

  it("rejects old or future timestamps (replay)", async () => {
    expect(await verifyStripeSignature(header, BODY, SECRET, T + 301)).toBe(false);
    expect(await verifyStripeSignature(header, BODY, SECRET, T - 301)).toBe(false);
  });

  it("rejects a changed body, wrong secret, or malformed header", async () => {
    expect(await verifyStripeSignature(header, BODY.replace("evt_1", "evt_2"), SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(header, BODY, "whsec_other", T)).toBe(false);
    expect(await verifyStripeSignature(null, BODY, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(`v1=${VECTOR}`, BODY, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(`t=${T}`, BODY, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(`t=${T},v1=${VECTOR.slice(0, 63)}`, BODY, SECRET, T)).toBe(false);
    expect(await verifyStripeSignature(header, BODY, "", T)).toBe(false);
  });
});
