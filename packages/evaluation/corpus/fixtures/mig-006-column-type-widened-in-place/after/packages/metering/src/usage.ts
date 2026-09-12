export type UsageEvent = { account_id: string; units: number };

export function totalUnits(events: UsageEvent[]): number {
  return events.reduce((sum, event) => sum + event.units, 0);
}

/** Units are counted per account, and the largest accounts exceed 2^31. */
export function totalUnitsByAccount(events: UsageEvent[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const event of events) {
    totals.set(event.account_id, (totals.get(event.account_id) ?? 0) + event.units);
  }
  return totals;
}
