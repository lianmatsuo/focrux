import { describe, expect, it } from "vitest";
import { orderTotal } from "../src/order.js";

describe("orderTotal", () => {
  it("returns the stored total", () => {
    expect(orderTotal({ id: "o1", account_id: "a1", total_cents: 1250 })).toBe(1250);
  });
});
