import { expect, it } from "vitest";
import { renderLine, renderTotal } from "../src/lines.js";

it("prints the amount as the last token of the line, so the reconciliation import can read it back", () => {
  const rendered = renderLine({ description: "Consulting, March", minor: 123456 });
  expect(rendered.trim().split(/\s+/).pop()).toBe("1234.56");
  expect(Number(rendered.trim().split(/\s+/).pop())).toBe(1234.56);
});

it("totals the lines in the same column", () => {
  const rendered = renderTotal([
    { description: "A", minor: 100000 },
    { description: "B", minor: 23456 },
  ]);
  expect(rendered.trim().split(/\s+/).pop()).toBe("1234.56");
});
