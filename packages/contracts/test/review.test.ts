import { describe, expect, it } from "vitest";
import { assertReviewerContextKind, mayOccupyInstructionPosition } from "../src/context.js";
import { AttemptUsageSchema } from "../src/attempt.js";
import { EXIT_CODES, exitCodeForDecision, findingKey } from "../src/review.js";
import { RunBundleSchema, RunCostBasisSchema } from "../src/runbundle.js";

describe("finding identity", () => {
  const parts = { rule_id: "criterion.unverified", criterion_id: "ac_2", file: "a.ts", symbol: "f" };

  it("is stable across runs for the same defect", () => {
    expect(findingKey(parts)).toBe(findingKey({ ...parts }));
  });

  it("changes when any part changes", () => {
    const base = findingKey(parts);
    expect(findingKey({ ...parts, rule_id: "other.rule" })).not.toBe(base);
    expect(findingKey({ ...parts, criterion_id: "ac_3" })).not.toBe(base);
    expect(findingKey({ ...parts, file: "b.ts" })).not.toBe(base);
    expect(findingKey({ ...parts, symbol: "g" })).not.toBe(base);
  });

  it("still produces a key when the finding has no symbol", () => {
    expect(findingKey({ rule_id: "scope.escape", file: "a.ts" })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not collide when an absent part is confused with an adjacent one", () => {
    // "a|b||" and "a||b|" must differ; a naive join of present parts would not.
    expect(findingKey({ rule_id: "r", criterion_id: "x", file: null })).not.toBe(
      findingKey({ rule_id: "r", criterion_id: null, file: "x" }),
    );
  });
});

describe("exit codes", () => {
  it("maps every decision", () => {
    expect(exitCodeForDecision("approve")).toBe(EXIT_CODES.approve);
    expect(exitCodeForDecision("changes_requested")).toBe(EXIT_CODES.gate_closed);
    expect(exitCodeForDecision("escalate")).toBe(EXIT_CODES.gate_closed);
    expect(exitCodeForDecision("error")).toBe(EXIT_CODES.did_not_complete);
    expect(exitCodeForDecision("incomplete")).toBe(EXIT_CODES.did_not_complete);
  });

  it("separates a closed gate from an absent review", () => {
    // A caller checking only for 2 must not be able to merge an unreviewed change.
    expect(exitCodeForDecision("error")).not.toBe(exitCodeForDecision("changes_requested"));
    expect(exitCodeForDecision("incomplete")).not.toBe(exitCodeForDecision("approve"));
  });

  it("gives approve the only zero", () => {
    const nonApprove = ["changes_requested", "escalate", "error", "incomplete"] as const;
    for (const decision of nonApprove) expect(exitCodeForDecision(decision)).not.toBe(0);
  });
});

describe("trust tiers", () => {
  it("admits only system and user to an instruction position", () => {
    expect(mayOccupyInstructionPosition("system")).toBe(true);
    expect(mayOccupyInstructionPosition("user")).toBe(true);
    expect(mayOccupyInstructionPosition("repo")).toBe(false);
    expect(mayOccupyInstructionPosition("external")).toBe(false);
  });

  it("refuses executor narrative and transcript as reviewer context", () => {
    expect(() => assertReviewerContextKind("executor_narrative")).toThrow();
    expect(() => assertReviewerContextKind("executor_transcript")).toThrow();
    expect(() => assertReviewerContextKind("diff")).not.toThrow();
  });
});

describe("cost basis on durable usage records", () => {
  it("preserves the historical attempt default and an explicit unavailable basis", () => {
    const usage = {
      input_tokens: 1,
      output_tokens: 1,
      cost_micros: 0,
      wall_clock_ms: 1,
      commands: 0,
      iterations: 1,
    };
    const historical = AttemptUsageSchema.parse(usage);
    expect(historical.cost_basis).toBe("transport_reported");
    expect(historical.cache_creation_input_tokens).toBe(0);
    expect(
      AttemptUsageSchema.parse({ ...usage, cost_basis: "unavailable" }).cost_basis,
    ).toBe("unavailable");
  });

  it("distinguishes a run with no model call from an unknown model charge", () => {
    expect(RunCostBasisSchema.parse("not_incurred")).toBe("not_incurred");
    expect(RunCostBasisSchema.parse("unavailable")).toBe("unavailable");
    const historical = RunBundleSchema.pick({ usage: true }).parse({
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cost_micros: 1,
        wall_clock_ms: 1,
      },
    });
    expect(historical.usage.cost_basis).toBe("unavailable");
  });
});
