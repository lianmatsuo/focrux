import { describe, expect, it } from "vitest";
import { tidy } from "../src/tidy.js";

describe("tidy", () => {
  it("collapses runs of whitespace", () => {
    expect(tidy("  a   b  ")).toBe("a b");
  });
});
