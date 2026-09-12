import { describe, expect, it } from "vitest";
import { toTable } from "../src/table.js";

describe("toTable", () => {
  it("pads columns to the widest cell", () => {
    expect(toTable([["name", "role"], ["Ada", "engineer"]])).toContain("name  role");
  });
});
