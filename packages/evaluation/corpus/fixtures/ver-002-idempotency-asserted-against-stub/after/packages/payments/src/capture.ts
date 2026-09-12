import { addCapture, hasCapture } from "./store.js";

export function capture(event_id: string, amount: number): { ok: true; deduped: boolean } {
  if (hasCapture(event_id)) return { ok: true, deduped: true };
  addCapture({ event_id, amount });
  return { ok: true, deduped: false };
}
