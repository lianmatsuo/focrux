import { describe, expect, it } from "vitest";
import { search } from "../src/query.js";

const docs = [
  { id: "1", title: "Quarterly plan", archived: false, owner_id: "u1" },
  { id: "2", title: "Quarterly review", archived: true, owner_id: "u2" },
];

describe("search", () => {
  it("matches on the title", () => {
    expect(search(docs, "quarterly").map((d) => d.id)).toEqual(["1", "2"]);
  });

  it("filters by owner", () => {
    expect(search(docs, "quarterly", { ownerId: "u1" }).map((d) => d.id)).toEqual(["1"]);
  });
});
