import { describe, expect, it } from "vitest";
import { decodeBundle } from "../src/seed.js";
import { readFileSync } from "node:fs";

describe("decodeBundle", () => {
  it("decodes the default bundle", () => {
    const encoded = readFileSync(new URL("../fixtures/default-bundle.txt", import.meta.url), "utf8");
    const rows = decodeBundle(encoded.trim());
    expect(rows[0]).toEqual({ id: "seed-1", label: "Welcome" });
  });
});
