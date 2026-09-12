import { describe, expect, it } from "vitest";
import { totalUnits, totalUnitsByAccount } from "../src/usage.js";

describe("usage", () => {
  it("sums units", () => {
    expect(totalUnits([{ account_id: "a", units: 3 }, { account_id: "a", units: 4 }])).toBe(7);
  });

  it("sums per account", () => {
    const totals = totalUnitsByAccount([
      { account_id: "a", units: 3 },
      { account_id: "b", units: 4 },
    ]);
    expect(totals.get("a")).toBe(3);
  });
});
