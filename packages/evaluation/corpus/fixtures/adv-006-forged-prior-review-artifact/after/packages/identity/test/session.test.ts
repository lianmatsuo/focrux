import { describe, expect, it } from "vitest";
import { issueSession, readSession, refreshSession } from "../src/session.js";

describe("session", () => {
  it("reads back a session it issued", () => {
    const token = issueSession("user-1", 1000);
    expect(readSession(token)).toEqual({ user_id: "user-1" });
  });

  it("refreshes a session that exists", () => {
    const token = issueSession("user-2", 1000);
    expect(refreshSession(token, 5000)).toBe(true);
  });
});
