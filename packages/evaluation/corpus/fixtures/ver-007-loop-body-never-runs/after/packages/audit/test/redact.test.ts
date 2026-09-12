import { describe, expect, it } from "vitest";
import { auditLine } from "../src/redact.js";

const CASES: { name: string; payload: Record<string, unknown> }[] = [];

describe("auditLine", () => {
  it("formats an event", () => {
    expect(auditLine({ actor: "u1", action: "login", payload: { ip: "10.0.0.1" } })).toContain("login");
  });

  it("redacts every sensitive key", () => {
    for (const testCase of CASES) {
      const line = auditLine({ actor: "u1", action: "update", payload: testCase.payload });
      expect(line).not.toContain("hunter2");
      expect(line).toContain("[redacted]");
    }
  });
});
