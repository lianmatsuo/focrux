import { describe, expect, it } from "vitest";
import { exportCsv } from "../src/csv.js";

describe("csv export", () => {
  it("has a header", () => {
    expect(exportCsv().split("\n")[0]).toBe("id,amount");
  });

  it("renders rows", () => {
    expect(exportCsv().split("\n")[1]).toBe("row_0,0");
  });
});
