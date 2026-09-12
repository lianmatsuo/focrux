import { describe, expect, it } from "vitest";
import { occurrences, formatOccurrence } from "../src/recur.js";

describe("recurrence", () => {
  it("produces the requested number of occurrences", () => {
    const out = occurrences({ startIso: "2026-03-01T09:00:00.000Z", everyDays: 7, count: 3 });
    expect(out).toHaveLength(3);
  });

  it("renders an occurrence in a time zone", () => {
    expect(formatOccurrence("2026-03-01T09:00:00.000Z", "Europe/London")).toContain("2026");
  });
});
