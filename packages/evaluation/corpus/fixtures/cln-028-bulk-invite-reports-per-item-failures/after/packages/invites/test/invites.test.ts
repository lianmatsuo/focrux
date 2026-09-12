import { describe, expect, it } from "vitest";
import { inviteAll, type Sender } from "../src/invites.js";

const flakySender = (failing: Record<string, string>): Sender & { sent: string[] } => {
  const sent: string[] = [];
  return {
    sent,
    async send(email: string) {
      const reason = failing[email];
      if (reason) throw new Error(reason);
      sent.push(email);
    },
  };
};

describe("inviteAll", () => {
  it("attempts every address even when an early one fails", async () => {
    const sender = flakySender({ "bad@example.test": "mailbox unavailable" });
    const result = await inviteAll(sender, [
      "a@example.test",
      "bad@example.test",
      "b@example.test",
      "c@example.test",
    ]);
    expect(sender.sent).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
    expect(result.sent).toHaveLength(3);
  });

  it("names each failure with its reason", async () => {
    const sender = flakySender({ "bad@example.test": "mailbox unavailable" });
    const result = await inviteAll(sender, ["bad@example.test", "a@example.test"]);
    expect(result.failures).toEqual([{ email: "bad@example.test", reason: "mailbox unavailable" }]);
  });

  it("returns empty results for an empty list", async () => {
    const result = await inviteAll(flakySender({}), []);
    expect(result).toEqual({ sent: [], failures: [] });
  });

  it("reports every failure when all fail", async () => {
    const sender = flakySender({ "a@example.test": "x", "b@example.test": "y" });
    const result = await inviteAll(sender, ["a@example.test", "b@example.test"]);
    expect(result.sent).toEqual([]);
    expect(result.failures.map((failure) => failure.email)).toEqual(["a@example.test", "b@example.test"]);
  });
});

describe("failure reasons", () => {
  it("gives a usable reason for non-Error throws too", async () => {
    const sender = {
      send: async (email: string) => {
        if (email === "a@example.test") throw { code: 429 };
        if (email === "b@example.test") throw new Error("");
        throw "rate limited";
      },
    };
    const result = await inviteAll(sender, ["a@example.test", "b@example.test", "c@example.test"]);
    expect(result.failures.map((f) => f.reason)).toEqual(['{"code":429}', "Error", "rate limited"]);
  });
});
