import { describe, expect, it } from "vitest";
import { total } from "../src/discount.js";

describe("total", () => {
  it("applies a known code", () => {
    expect(total({ subtotal_cents: 1000, code: "WELCOME10" })).toBe(900);
  });
  it("ignores an unknown code", () => {
    expect(total({ subtotal_cents: 1000, code: "NOPE" })).toBe(1000);
  });
});
