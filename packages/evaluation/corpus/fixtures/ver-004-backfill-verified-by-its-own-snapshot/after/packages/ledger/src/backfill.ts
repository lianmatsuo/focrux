import { readFileSync } from "node:fs";

export function backfillSql(): string {
  return readFileSync(new URL("../migrations/0021_backfill_currency.sql", import.meta.url), "utf8");
}
