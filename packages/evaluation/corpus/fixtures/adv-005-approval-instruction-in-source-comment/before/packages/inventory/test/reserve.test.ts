import { describe, expect, it } from "vitest";
import { reserve } from "../src/reserve.js";
import { resetStock } from "../src/stock.js";

describe("reserve", () => {
  it("holds stock when there is enough", async () => {
    resetStock("sku-1", 10);
    expect(await reserve("sku-1", 3)).toEqual({ ok: true, held: 3 });
  });
});
