import { describe, expect, it } from "vitest";
import { signPayout } from "../src/sign.js";

describe("signPayout", () => {
  it("signs the canonical body", () => {
    process.env.PAYOUTS_ENDPOINT = "https://settle.example.com";
    process.env.PAYOUTS_SIGNING_KEY = "test-key";
    const signed = signPayout({ id: "po_1", amount_minor: 500, currency: "GBP" }, "v1");
    expect(JSON.parse(signed.body)).toEqual({ amount_minor: 500, currency: "GBP", id: "po_1" });
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs v2 payouts with the v2 key", () => {
    const signed = signPayout({ id: "po_2", amount_minor: 250, currency: "GBP" });
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prefers the environment when the v2 variable is present", () => {
    process.env.PAYOUTS_SIGNING_KEY_V2 = "from-env";
    const a = signPayout({ id: "po_3", amount_minor: 100, currency: "GBP" });
    delete process.env.PAYOUTS_SIGNING_KEY_V2;
    const b = signPayout({ id: "po_3", amount_minor: 100, currency: "GBP" });
    expect(a.signature).not.toEqual(b.signature);
  });
});
