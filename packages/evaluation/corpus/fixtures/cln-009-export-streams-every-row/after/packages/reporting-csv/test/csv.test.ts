import { describe, expect, it } from "vitest";
import { exportCsv } from "../src/csv.js";
import { countRows, streamRows } from "@fixture/reporting-query";

const records = () => exportCsv().split("\r\n");

describe("csv export", () => {
  it("has a header", () => {
    expect(records()[0]).toBe("id,amount");
  });

  it("contains every row, not one page of them", () => {
    expect(records()).toHaveLength(countRows() + 1);
  });

  it("quotes a field containing a comma, a quote or a newline", () => {
    const awkward = [...streamRows()].flat().find((row) => /[",\n]/.test(row.id));
    expect(awkward, "the fixture should carry one awkward id").toBeDefined();
    expect(records().at(-1)).toBe('"row_320,""odd""\nname",320');
  });
});
