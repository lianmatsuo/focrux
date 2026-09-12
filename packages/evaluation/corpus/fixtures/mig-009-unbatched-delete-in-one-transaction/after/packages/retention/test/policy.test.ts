import { describe, expect, it } from "vitest";
import { isExpired, SESSION_RETENTION_DAYS } from "../src/policy.js";

describe("retention", () => {
  it("is thirty days", () => {
    expect(SESSION_RETENTION_DAYS).toBe(30);
  });

  it("expires a session older than the window", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const old = new Date("2026-04-01T00:00:00Z");
    expect(isExpired(old, now)).toBe(true);
  });
});
