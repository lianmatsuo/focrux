import { query } from "./db.js";

export type Row = { id: string; created_at: string; amount_cents: number };
export type Sort = { column: string; direction: string };

export async function listInvoices(accountId: string, sort?: Sort): Promise<Row[]> {
  const order = sort ? `ORDER BY ${sort.column} ${sort.direction}` : "ORDER BY created_at DESC";
  return query<Row>(
    `SELECT id, created_at, amount_cents FROM invoices WHERE account_id = $1 ${order}`,
    [accountId],
  );
}
