import { describe, expect, it } from "vitest";
import { rebuildAll } from "../src/build.js";

const docs = Array.from({ length: 400 }, (_, i) => ({ id: `d${i}`, text: `alpha beta ${i}` }));

describe("rebuildAll", () => {
  it("indexes every document", () => {
    const index = rebuildAll(docs);
    expect(index.get("alpha")?.length).toBe(400);
  });
});
