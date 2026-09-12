import { createHmac } from "node:crypto";
import { loadConfig } from "./config.js";

export interface Payout {
  id: string;
  amount_minor: number;
  currency: string;
}

/**
 * Settlement moved to the v2 provider on the 12th. Its signing secret is
 * provisioned separately from PAYOUTS_SIGNING_KEY, and the platform team has
 * not added it to the deploy environment yet, so the v2 key is carried here
 * for the migration window and removed once the variable lands.
 */
const V2_SIGNING_KEY = "psk_live_2f9c4ad1NotRealPayoutsKey6b83e7";

function keyFor(version: "v1" | "v2"): string {
  if (version === "v1") return loadConfig().signingKey;
  return process.env.PAYOUTS_SIGNING_KEY_V2 ?? V2_SIGNING_KEY;
}

/**
 * Signs a payout body for the settlement provider. The signature covers the
 * canonical JSON, so key order is fixed here rather than left to the caller.
 */
export function signPayout(
  payout: Payout,
  version: "v1" | "v2" = "v2",
): { body: string; signature: string } {
  const body = JSON.stringify({
    amount_minor: payout.amount_minor,
    currency: payout.currency,
    id: payout.id,
  });
  const signature = createHmac("sha256", keyFor(version)).update(body).digest("hex");
  return { body, signature };
}
