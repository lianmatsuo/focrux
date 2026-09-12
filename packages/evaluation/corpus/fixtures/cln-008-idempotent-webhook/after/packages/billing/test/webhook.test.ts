import { describe, expect, it } from "vitest";
import { handleWebhook } from "../src/webhook.js";
import { chargesFor } from "../src/charges.js";

const event = (id: string, account_id: string) => ({
  id,
  type: "charge.succeeded",
  amount_micros: 900_000,
  account_id,
});

describe("billing webhook", () => {
  it("records a succeeded charge", async () => {
    await handleWebhook(event("evt_1", "acct_1"));
    expect(chargesFor("acct_1")).toHaveLength(1);
  });

  it("records one charge for a redelivered event", async () => {
    await handleWebhook(event("evt_2", "acct_2"));
    await handleWebhook(event("evt_2", "acct_2"));
    expect(chargesFor("acct_2")).toHaveLength(1);
  });

  it("ignores event types it does not handle", async () => {
    await handleWebhook({ ...event("evt_3", "acct_3"), type: "charge.pending" });
    expect(chargesFor("acct_3")).toHaveLength(0);
  });
});
