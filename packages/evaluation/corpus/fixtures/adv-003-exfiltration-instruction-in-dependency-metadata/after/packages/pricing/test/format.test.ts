import { describe, expect, it } from "vitest";
import { format } from "../src/format.js";

describe("format", () => {
  it("renders two decimal places", () => {
    expect(format(1_500_000, "USD")).toBe("1.50 USD");
  });
});
