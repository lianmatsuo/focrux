import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  DEFAULT_LIMITS_TABLE,
  LimitExceededError,
  LimitsTableSchema,
  assertProviderEnabled,
  assertWithinLimits,
  limitFor,
} from "../src/limits.js";

describe("assertWithinLimits", () => {
  it("gates every countable resource through one call", () => {
    expect(() =>
      assertWithinLimits(DEFAULT_LIMITS_TABLE, "concurrent_local_attempts", 1),
    ).not.toThrow();
    expect(() => assertWithinLimits(DEFAULT_LIMITS_TABLE, "concurrent_local_attempts", 2)).toThrow(
      LimitExceededError,
    );
  });

  it("defaults concurrent_local_attempts to 1 and states a workspace byte ceiling (D-049)", () => {
    expect(DEFAULT_LIMITS.concurrent_local_attempts).toBe(1);
    expect(DEFAULT_LIMITS.local_workspace_bytes).toBeGreaterThan(0);
  });

  it("carries the resource, the limit and the requested value on the refusal", () => {
    const table = LimitsTableSchema.parse({ organisation: "org", limits: { attempt_commands: 200 } });
    try {
      assertWithinLimits(table, "attempt_commands", 10_000);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LimitExceededError);
      const typed = error as LimitExceededError;
      expect(typed.reason).toBe("limit_exceeded");
      expect(typed.resource).toBe("attempt_commands");
      expect(typed.limit).toBe(200);
      expect(typed.requested).toBe(10_000);
    }
  });

  it("treats equal to the limit as within it", () => {
    const table = LimitsTableSchema.parse({ organisation: "org", limits: { attempt_commands: 3 } });
    expect(() => assertWithinLimits(table, "attempt_commands", 3)).not.toThrow();
    expect(() => assertWithinLimits(table, "attempt_commands", 4)).toThrow(LimitExceededError);
  });

  it("stops everything under global read-only, before any per-resource check", () => {
    const table = LimitsTableSchema.parse({
      organisation: "org",
      limits: { attempt_commands: 1000 },
      kill_switches: { global_read_only: true },
    });
    try {
      assertWithinLimits(table, "attempt_commands", 1);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as LimitExceededError).reason).toBe("read_only_mode");
    }
  });

  it("stops an organisation whose automation is disabled", () => {
    const table = LimitsTableSchema.parse({
      organisation: "org",
      kill_switches: { organisation_automation_disabled: true },
    });
    expect(() => assertWithinLimits(table, "attempt_tokens", 1)).toThrow(/automation is disabled/);
  });
});

describe("limits table", () => {
  it("rejects an unknown resource name rather than silently raising no ceiling", () => {
    const parsed = LimitsTableSchema.safeParse({
      organisation: "org",
      limits: { attempt_command: 5 },
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("unknown limited resource");
  });

  it("falls back to the default for a resource with no override", () => {
    const table = LimitsTableSchema.parse({ organisation: "org" });
    expect(limitFor(table, "attempt_tokens")).toBe(DEFAULT_LIMITS.attempt_tokens);
  });

  /**
   * D-096. The three counters have no default: an iteration is one assistant
   * event and a command is one tool call, and both were proxies for spend that
   * cut ordinary work. A table without them is a table with no ceiling on them.
   */
  it("accepts a table naming none of the three counters, and bounds neither", () => {
    const table = LimitsTableSchema.parse({ organisation: "org" });
    for (const resource of ["attempt_iterations", "round_iterations", "attempt_commands"] as const) {
      expect(DEFAULT_LIMITS[resource]).toBeUndefined();
      expect(limitFor(table, resource)).toBeNull();
      expect(() => assertWithinLimits(table, resource, 10_000)).not.toThrow();
    }
  });

  it("accepts a table that sets them, and each one still fires at what it says", () => {
    const table = LimitsTableSchema.parse({
      organisation: "org",
      limits: { attempt_iterations: 400, round_iterations: 80, attempt_commands: 400 },
    });
    expect(limitFor(table, "attempt_iterations")).toBe(400);
    expect(limitFor(table, "round_iterations")).toBe(80);
    expect(limitFor(table, "attempt_commands")).toBe(400);
    expect(() => assertWithinLimits(table, "attempt_iterations", 401)).toThrow(LimitExceededError);
    expect(() => assertWithinLimits(table, "round_iterations", 81)).toThrow(LimitExceededError);
    expect(() => assertWithinLimits(table, "attempt_commands", 401)).toThrow(LimitExceededError);
  });

  /**
   * A record written before D-096 names them, and it still parses: the schema
   * is the same closed key set, and only the default came out.
   */
  it("keeps an older configuration that names them parsing", () => {
    const parsed = LimitsTableSchema.safeParse({
      organisation: "focrux",
      limits: { attempt_iterations: 400, round_iterations: 80, attempt_commands: 400 },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("assertProviderEnabled", () => {
  it("refuses a disabled provider and a disabled model separately", () => {
    const table = LimitsTableSchema.parse({
      organisation: "org",
      kill_switches: { disabled_providers: ["claude-cli"], disabled_models: ["claude-opus-5"] },
    });
    expect(() => assertProviderEnabled(table, "claude-cli", "x")).toThrow(/provider claude-cli/);
    expect(() => assertProviderEnabled(table, "anthropic", "claude-opus-5")).toThrow(
      /model claude-opus-5/,
    );
    expect(() => assertProviderEnabled(table, "anthropic", "other")).not.toThrow();
  });
});
