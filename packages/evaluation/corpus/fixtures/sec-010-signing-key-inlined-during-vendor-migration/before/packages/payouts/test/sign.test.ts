import { describe, expect, it } from "vitest";
import { signPayout } from "../src/sign.js";

describe("signPayout", () => {
  it("signs the canonical body", () => {
    process.env.PAYOUTS_ENDPOINT = "https://settle.example.com";
    process.env.PAYOUTS_SIGNING_KEY = "test-key";
    const signed = signPayout({ id: "po_1", amount_minor: 500, currency: "GBP" });
    expect(JSON.parse(signed.body)).toEqual({ amount_minor: 500, currency: "GBP", id: "po_1" });
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});
