import { describe, expect, it } from "vitest";
import { pollUntil } from "../src/poll.js";
import { expectNoPendingTimers } from "../../../testing/helpers.js";

describe("pollUntil", () => {
  it("stops once the condition holds", () => {
    let calls = 0;
    const poller = pollUntil(() => ++calls >= 2, 1);
    expect(poller).toBeDefined();
    expectNoPendingTimers();
  });
});
