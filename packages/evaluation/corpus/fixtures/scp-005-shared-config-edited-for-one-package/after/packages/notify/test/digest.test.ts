import { describe, expect, it } from "vitest";
import { digestSubject } from "../src/digest.js";

describe("digestSubject", () => {
  it("uses English by default", () => {
    expect(digestSubject({ user_id: "u1", items: ["a"] })).toContain("You have");
  });

  it("uses the requested locale", () => {
    expect(digestSubject({ user_id: "u1", items: ["a"], locale: "fr" })).toContain("Vous avez");
  });
});
