import { describe, expect, it } from "vitest";
import { formatPrice } from "../src/format.js";

describe("formatPrice", () => {
  it("renders whole and fractional amounts", () => {
    expect(formatPrice(1999)).toBe("$19.99");
    expect(formatPrice(500)).toBe("$5.00");
  });
});
