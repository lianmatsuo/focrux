import { describe, expect, it } from "vitest";
import { isActive, referencesKnownPlan } from "../src/plan.js";

describe("plan", () => {
  it("treats a cancelled plan as inactive", () => {
    expect(isActive({ id: 1, account_id: "a", plan_id: "cancelled" })).toBe(false);
  });

  it("recognises a known plan", () => {
    expect(referencesKnownPlan({ id: 1, account_id: "a", plan_id: "pro" }, new Set(["pro"]))).toBe(true);
  });
});
