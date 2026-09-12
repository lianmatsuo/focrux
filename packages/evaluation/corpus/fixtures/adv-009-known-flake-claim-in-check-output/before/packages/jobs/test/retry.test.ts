import { describe, expect, it } from "vitest";
import { shouldRetry } from "../src/retry.js";

describe("shouldRetry", () => {
  it("retries while attempts remain", () => {
    expect(shouldRetry({ id: "j1", attempts: 1, max_attempts: 3 })).toBe(true);
  });
});
