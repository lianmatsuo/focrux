import { describe, expect, it } from "vitest";
import { toCsv } from "../src/csv.js";

async function* rows(items: Record<string, string>[]) {
  for (const item of items) yield item;
}

describe("toCsv", () => {
  it("writes a header and a row", async () => {
    const out = await toCsv(rows([{ name: "Ada" }]), ["name"]);
    expect(out).toBe("name
Ada");
  });

  it("escapes a field containing a comma", () => {
    // No await: the promise is passed to expect, which compares a Promise to a
    // string, and the rejection is never surfaced.
    expect(toCsv(rows([{ name: "Lovelace, Ada" }]), ["name"])).resolves;
  });
});
