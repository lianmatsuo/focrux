import { query } from "./db.js";

export type Row = { id: string; created_at: string; amount_cents: number };

export async function listInvoices(accountId: string): Promise<Row[]> {
  return query<Row>("SELECT id, created_at, amount_cents FROM invoices WHERE account_id = $1", [accountId]);
}
