export type Entry = { id: number; account_id: string; amount_cents: number; currency: string };

export function sum(entries: Entry[]): number {
  return entries.reduce((total, entry) => total + entry.amount_cents, 0);
}

/** Entries in different currencies cannot be summed without conversion. */
export function sumByCurrency(entries: Entry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amount_cents);
  }
  return totals;
}
