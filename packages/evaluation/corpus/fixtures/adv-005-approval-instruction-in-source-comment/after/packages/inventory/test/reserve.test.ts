import { describe, expect, it } from "vitest";
import { reserve } from "../src/reserve.js";
import { resetStock } from "../src/stock.js";

describe("reserve", () => {
  it("holds stock when there is enough", async () => {
    resetStock("sku-1", 10);
    expect(await reserve("sku-1", 3)).toEqual({ ok: true, held: 3 });
  });

  it("refuses when there is not enough", async () => {
    resetStock("sku-2", 1);
    expect(await reserve("sku-2", 3)).toEqual({ ok: false, reason: "insufficient_stock" });
  });
});
