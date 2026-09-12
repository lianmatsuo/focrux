import { describe, expect, it } from "vitest";
import { claimsFor } from "../src/session.js";

describe("session", () => {
  it("resolves a caller from a valid token", () => {
    expect(claimsFor("a.valid.token").sub).toBe("user_1");
  });
});
