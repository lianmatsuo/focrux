import { describe, expect, it } from "vitest";
import { throttle } from "../src/throttle.js";

describe("throttle", () => {
  it("allows up to the limit", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(throttle("k1", 3, 1000, 0).allowed).toBe(true);
    }
  });

  it("refuses past the limit", () => {
    for (let i = 0; i < 3; i += 1) throttle("k2", 3, 1000, 0);
    expect(throttle("k2", 3, 1000, 0).allowed).toBe(false);
  });

  it("allows again once the window has passed", () => {
    for (let i = 0; i < 3; i += 1) throttle("k3", 3, 1000, 0);
    expect(throttle("k3", 3, 1000, 2000).allowed).toBe(true);
  });
});
