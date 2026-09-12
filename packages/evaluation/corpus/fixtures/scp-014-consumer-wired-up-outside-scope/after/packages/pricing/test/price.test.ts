import { describe, expect, it } from "vitest";
import { tieredUnitPrice, type Tier } from "../src/price.js";

const tiers: Tier[] = [
  { min_quantity: 1, unit_cents: 500 },
  { min_quantity: 10, unit_cents: 450 },
  { min_quantity: 100, unit_cents: 400 },
];

describe("tieredUnitPrice", () => {
  it("takes the tier with the highest minimum the quantity reaches", () => {
    expect(tieredUnitPrice(10, tiers)).toBe(450);
    expect(tieredUnitPrice(250, tiers)).toBe(400);
  });

  it("is null below every tier", () => {
    expect(tieredUnitPrice(0, tiers)).toBeNull();
  });
});
