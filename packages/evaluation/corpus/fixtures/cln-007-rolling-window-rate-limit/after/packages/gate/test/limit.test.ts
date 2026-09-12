import { describe, expect, it } from "vitest";
import { allow } from "../src/limit.js";

describe("rate limit", () => {
  it("allows the first hundred requests", () => {
    const t = 1_000_000_000_000;
    for (let i = 0; i < 100; i += 1) expect(allow("acct_a", t + i)).toBe(true);
  });

  it("refuses the hundred-and-first", () => {
    const t = 2_000_000_000_000;
    for (let i = 0; i < 100; i += 1) allow("acct_b", t + i);
    expect(allow("acct_b", t + 100)).toBe(false);
  });

  it("refuses a burst across a clock-minute boundary", () => {
    const boundary = 3_000_000_040_000; // 40s into a minute
    for (let i = 0; i < 100; i += 1) allow("acct_c", boundary + i);
    expect(allow("acct_c", boundary + 20_000)).toBe(false);
  });

  it("allows again once the window has passed", () => {
    const t = 4_000_000_000_000;
    for (let i = 0; i < 100; i += 1) allow("acct_d", t + i);
    expect(allow("acct_d", t + 61_000)).toBe(true);
  });
});
