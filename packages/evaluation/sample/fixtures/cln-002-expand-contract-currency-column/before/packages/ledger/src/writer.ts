import { query } from "./db.js";

export async function postEntry(account_id: string, amount: number): Promise<void> {
  await query("INSERT INTO ledger_entries (account_id, amount) VALUES ($1, $2)", [
    account_id,
    amount,
  ]);
}
