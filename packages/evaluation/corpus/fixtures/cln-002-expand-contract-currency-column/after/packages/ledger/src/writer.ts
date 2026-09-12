import { query } from "./db.js";

export async function postEntry(
  account_id: string,
  amount: number,
  currency = "usd",
): Promise<void> {
  await query(
    "INSERT INTO ledger_entries (account_id, amount, currency) VALUES ($1, $2, $3)",
    [account_id, amount, currency],
  );
}

/** Reads tolerate a null currency until the 0013 backfill has run. */
export async function currencyOf(entry_id: number): Promise<string> {
  const rows = await query<{ currency: string | null }>(
    "SELECT currency FROM ledger_entries WHERE id = $1",
    [entry_id],
  );
  return rows[0]?.currency ?? "usd";
}
