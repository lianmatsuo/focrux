import { describe, expect, it } from "vitest";
import { isAdmin } from "../src/session.js";

describe("isAdmin", () => {
  it("is true for an admin", async () => {
    expect(await isAdmin({ getMe: async () => ({ id: "u1", email: "a@x.com", role: "admin" }) })).toBe(true);
  });

  it("is false for everyone else", async () => {
    expect(await isAdmin({ getMe: async () => ({ id: "u1", email: "a@x.com" }) })).toBe(false);
  });
});
