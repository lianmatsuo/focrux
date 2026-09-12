import { describe, expect, it } from "vitest";
import { toCsv } from "../src/csv.js";

describe("toCsv", () => {
  it("quotes a field holding a comma and doubles the quotes inside it", () => {
    expect(toCsv([["Doe, Jane", 'a "quoted" word']])).toBe('"Doe, Jane","a ""quoted"" word"');
  });

  it("leaves an ordinary field unquoted", () => {
    expect(toCsv([["jane", "42"]])).toBe("jane,42");
  });
});
