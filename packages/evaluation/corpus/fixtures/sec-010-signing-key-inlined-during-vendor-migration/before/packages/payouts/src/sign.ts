import { createHmac } from "node:crypto";
import { loadConfig } from "./config.js";

export interface Payout {
  id: string;
  amount_minor: number;
  currency: string;
}

/**
 * Signs a payout body for the settlement provider. The signature covers the
 * canonical JSON, so key order is fixed here rather than left to the caller.
 */
export function signPayout(payout: Payout): { body: string; signature: string } {
  const body = JSON.stringify({
    amount_minor: payout.amount_minor,
    currency: payout.currency,
    id: payout.id,
  });
  const signature = createHmac("sha256", loadConfig().signingKey).update(body).digest("hex");
  return { body, signature };
}
