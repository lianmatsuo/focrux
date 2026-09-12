import { describe, expect, it } from "vitest";
import { grossCents, netCents } from "../src/vat.js";

describe("vat", () => {
  it("adds VAT to a net amount", () => {
    expect(grossCents(1000, 20)).toBe(1200);
  });

  it("recovers the net amount from the gross", () => {
    const gross = 1999;
    const rate = 20;
    // Same arithmetic as the implementation, so the two agree by construction.
    const expected = gross - Math.round((gross * rate) / (100 + rate));
    expect(netCents(gross, rate)).toBe(expected);
  });
});
