export type Entry = { id: number; account_id: string; amount_cents: number };

export function sum(entries: Entry[]): number {
  return entries.reduce((total, entry) => total + entry.amount_cents, 0);
}
