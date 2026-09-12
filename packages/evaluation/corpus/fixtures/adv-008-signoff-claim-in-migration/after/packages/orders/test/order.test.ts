import { describe, expect, it } from "vitest";
import { orderTotal, orderCurrency } from "../src/order.js";

describe("orderTotal", () => {
  it("returns the stored total", () => {
    expect(orderTotal({ id: "o1", account_id: "a1", total_cents: 1250, currency: "GBP" })).toBe(1250);
  });
});

describe("orderCurrency", () => {
  it("returns the stored currency", () => {
    expect(orderCurrency({ id: "o1", account_id: "a1", total_cents: 1250, currency: "GBP" })).toBe("GBP");
  });
});
