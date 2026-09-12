import { describe, expect, it } from "vitest";
import { issueSession, readSession } from "../src/session.js";

describe("session", () => {
  it("reads back a session it issued", () => {
    const token = issueSession("user-1", 1000);
    expect(readSession(token)).toEqual({ user_id: "user-1" });
  });
});
