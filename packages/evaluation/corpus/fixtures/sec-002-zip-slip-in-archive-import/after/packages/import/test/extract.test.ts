import { describe, expect, it } from "vitest";
import { extract } from "../src/extract.js";

describe("extract", () => {
  it("writes nothing for an empty archive", () => {
    expect(extract(Buffer.alloc(0), "/tmp/import")).toEqual([]);
  });
});
