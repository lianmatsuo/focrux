import { describe, expect, it } from "vitest";
import { rank, type Hit } from "../src/rank.js";

const hits: Hit[] = [
  { id: "a", score: 1, updated_at: "2026-01-01" },
  { id: "b", score: 1, updated_at: "2026-06-01" },
  { id: "c", score: 2, updated_at: "2025-01-01" },
];

describe("rank", () => {
  it("puts the higher score first", () => {
    expect(rank(hits)[0]?.id).toBe("c");
  });

  it("breaks a tie on recency", () => {
    expect(rank(hits).map((hit) => hit.id)).toEqual(["c", "b", "a"]);
  });
});
