import { beforeEach, describe, expect, it } from "vitest";
import { deliver, deliveryLog } from "../src/deliver.js";

const delivery = { url: "https://example.com/hook", body: "{}", attempt: 0 };

describe("deliver", () => {
  it("reports success on a 2xx", async () => {
    expect(await deliver(delivery, async () => 200)).toBe(true);
  });

  it("retries a 5xx", async () => {
    await deliver(delivery, async () => 503);
    // Asserts the log, not the calls.
    expect(deliveryLog().filter((line) => line.includes("status=503")).length).toBeGreaterThan(1);
  });
});
