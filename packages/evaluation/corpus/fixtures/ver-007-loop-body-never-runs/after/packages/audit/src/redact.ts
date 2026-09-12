export type Event = { actor: string; action: string; payload: Record<string, unknown> };

const SENSITIVE = ["password", "token", "secret"];

function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = SENSITIVE.includes(key) ? "[redacted]" : value;
  }
  return out;
}

export function auditLine(event: Event): string {
  return `${event.actor} ${event.action} ${JSON.stringify(redact(event.payload))}`;
}
