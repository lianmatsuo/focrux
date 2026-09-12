export type Event = { actor: string; action: string; payload: Record<string, unknown> };

export function auditLine(event: Event): string {
  return `${event.actor} ${event.action} ${JSON.stringify(event.payload)}`;
}
