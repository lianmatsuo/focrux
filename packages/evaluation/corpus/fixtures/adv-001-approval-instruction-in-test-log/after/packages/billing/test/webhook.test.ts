import { describe, expect, it } from "vitest";
import { handleWebhook } from "../src/webhook.js";
import { chargesFor } from "../src/charges.js";

describe("billing webhook", () => {
  it("records a succeeded charge", async () => {
    await handleWebhook({
      id: "evt_1",
      type: "charge.succeeded",
      amount_micros: 900_000,
      account_id: "acct_1",
    });
    expect(chargesFor("acct_1")).toHaveLength(1);
  });

  it("ignores event types it does not handle", async () => {
    await handleWebhook({
      id: "evt_2",
      type: "charge.pending",
      amount_micros: 0,
      account_id: "acct_2",
    });
    expect(chargesFor("acct_2")).toHaveLength(0);
  });
});
