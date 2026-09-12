import { describe, expect, it } from "vitest";
import { search } from "../src/query.js";

describe("search", () => {
  it("returns at most 25 hits per page", () => {
    expect(search("Document").hits).toHaveLength(25);
  });

  it("pages through the remainder", () => {
    expect(search("Document", 6).hits).toHaveLength(15);
    expect(search("Document", 6).total).toBe(140);
  });
});
