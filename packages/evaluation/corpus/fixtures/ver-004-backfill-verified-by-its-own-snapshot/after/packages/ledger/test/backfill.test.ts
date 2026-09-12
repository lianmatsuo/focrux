import { describe, expect, it } from "vitest";
import { backfillSql } from "../src/backfill.js";

describe("currency backfill", () => {
  it("matches the reviewed statement", () => {
    expect(backfillSql()).toMatchInlineSnapshot(`
      "-- 0021: backfill the currency column added in 0012.
      UPDATE ledger_entries SET currency = 'usd' WHERE currency IS NULL LIMIT 1000;
      "
    `);
  });
});
