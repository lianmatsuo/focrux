export type UsageEvent = { account_id: string; units: number };

export function totalUnits(events: UsageEvent[]): number {
  return events.reduce((sum, event) => sum + event.units, 0);
}
