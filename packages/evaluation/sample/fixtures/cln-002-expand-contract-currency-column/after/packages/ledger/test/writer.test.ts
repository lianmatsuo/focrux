import { describe, expect, it } from "vitest";
import { postEntry, currencyOf } from "../src/writer.js";

describe("ledger currency", () => {
  it("writes a currency for a new entry", async () => {
    await expect(postEntry("acct_1", 100, "eur")).resolves.toBeUndefined();
  });

  it("reads usd for an entry written before the backfill", async () => {
    expect(await currencyOf(1)).toBe("usd");
  });
});
