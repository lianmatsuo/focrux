import { hasCharge, recordCharge, type WebhookEvent } from "./charges.js";

/**
 * Accept a payment-provider webhook. The provider retries any delivery it does
 * not see a 2xx for, so the same event id arrives more than once in practice.
 */
export async function handleWebhook(event: WebhookEvent): Promise<{ ok: true }> {
  if (event.type !== "charge.succeeded") return { ok: true };
  if (hasCharge(event.id)) return { ok: true };
  recordCharge(event);
  return { ok: true };
}
