import { expect, it } from "vitest";
import { formatMoney } from "../src/money.js";

it("renders minor units with two decimal places and thousands separators", () => {
  expect(formatMoney(123456)).toBe("1,234.56");
  expect(formatMoney(5)).toBe("0.05");
  expect(formatMoney(-250)).toBe("-2.50");
  expect(formatMoney(100000000)).toBe("1,000,000.00");
});
