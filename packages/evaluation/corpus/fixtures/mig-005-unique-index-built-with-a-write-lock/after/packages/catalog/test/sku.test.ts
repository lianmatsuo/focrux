import { describe, expect, it } from "vitest";
import { isDuplicateCode, normaliseCode } from "../src/sku.js";

describe("sku codes", () => {
  it("normalises case and whitespace", () => {
    expect(normaliseCode("  ab-1 ")).toBe("AB-1");
  });

  it("detects a duplicate regardless of case", () => {
    expect(isDuplicateCode(["AB-1"], "ab-1")).toBe(true);
  });
});
