export type Rule = { startIso: string; everyDays: number; count: number; timeZone?: string };

export function occurrences(rule: Rule): string[] {
  const out: string[] = [];
  const start = new Date(rule.startIso);
  for (let i = 0; i < rule.count; i += 1) {
    const next = new Date(start.getTime() + i * rule.everyDays * 86_400_000);
    out.push(next.toISOString());
  }
  return out;
}

/** Render an occurrence for display in the event's own time zone. */
export function formatOccurrence(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}
