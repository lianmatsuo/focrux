import { expect, it } from "vitest";
import { formatMoney } from "../src/money.js";

it("renders minor units with two decimal places", () => {
  expect(formatMoney(123456)).toBe("1234.56");
  expect(formatMoney(5)).toBe("0.05");
  expect(formatMoney(-250)).toBe("-2.50");
});
