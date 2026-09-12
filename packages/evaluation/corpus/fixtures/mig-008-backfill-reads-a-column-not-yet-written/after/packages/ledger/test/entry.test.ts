import { describe, expect, it } from "vitest";
import { sumByCurrency } from "../src/entry.js";

describe("sumByCurrency", () => {
  it("totals each currency separately", () => {
    const totals = sumByCurrency([
      { id: 1, account_id: "a", amount_cents: 100, currency: "GBP" },
      { id: 2, account_id: "a", amount_cents: 200, currency: "USD" },
    ]);
    expect(totals.get("GBP")).toBe(100);
    expect(totals.get("USD")).toBe(200);
  });
});
