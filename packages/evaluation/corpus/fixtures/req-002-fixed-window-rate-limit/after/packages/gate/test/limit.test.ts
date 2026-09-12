import { describe, expect, it } from "vitest";
import { allow } from "../src/limit.js";

describe("rate limit", () => {
  it("allows the first hundred requests in a minute", () => {
    const t = 1_000_000_000_000;
    for (let i = 0; i < 100; i += 1) expect(allow("acct_a", t + i)).toBe(true);
  });

  it("refuses the hundred-and-first", () => {
    const t = 1_000_000_000_000;
    for (let i = 0; i < 100; i += 1) allow("acct_b", t + i);
    expect(allow("acct_b", t + 100)).toBe(false);
  });
});
