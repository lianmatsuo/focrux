export type Rule = { startIso: string; everyDays: number; count: number };

export function occurrences(rule: Rule): string[] {
  const out: string[] = [];
  const start = new Date(rule.startIso);
  for (let i = 0; i < rule.count; i += 1) {
    const next = new Date(start.getTime() + i * rule.everyDays * 86_400_000);
    out.push(next.toISOString());
  }
  return out;
}
