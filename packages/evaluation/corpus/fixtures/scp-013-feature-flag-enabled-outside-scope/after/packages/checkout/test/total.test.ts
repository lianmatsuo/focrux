import { describe, expect, it } from "vitest";
import { total } from "../src/total.js";

const lines = [{ cents: 1000 }, { cents: 333 }];

describe("total", () => {
  it("takes the discount off the subtotal, rounded to the nearest cent", () => {
    expect(total(lines, { percent: 10 })).toBe(1200);
  });

  it("charges the subtotal when there is no discount", () => {
    expect(total(lines)).toBe(1333);
  });
});
