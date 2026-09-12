import { describe, expect, it } from "vitest";
import { decideBlocking, type BlockingInput } from "../src/blocking.js";

/**
 * The D-064 gate: a finding with a direction is fixed and notified; a finding
 * without one stops the merge.
 *
 * `negative` routes to the executor on every routable row while rounds remain,
 * whatever the closure answer — the owner's rule is "for anything even
 * slightly negative, the AI could fix it", and the human turn survives as the
 * last round, where nothing is remediable and the finding blocks. `neutral`
 * and `unsure` keep the d056 outcome, so the gate never widens on a missing or
 * hedged answer. `security.*` and `context.*` stop regardless of direction,
 * per the owner's 2026-08-30 ruling recorded in D-064.
 */

const base: BlockingInput = {
  row: "semantic_high_risk",
  rule_id: "durability.in_memory_store",
  confidence: 0.9,
  risk_level: "P2",
  rule_demoted: false,
  waived: false,
  closure: "human",
  direction: null,
  remediation_available: true,
  policy: "d064",
};

describe("d064: negative findings are fixed, not stopped", () => {
  it("routes a negative high-risk semantic finding even when closure says human", () => {
    const decision = decideBlocking({ ...base, direction: "negative" });
    expect(decision.outcome).toBe("remediable");
    expect(decision.blocking).toBe(false);
  });

  it("routes a negative finding below the confidence floor instead of escalating", () => {
    const decision = decideBlocking({ ...base, direction: "negative", confidence: 0.4 });
    expect(decision.outcome).toBe("remediable");
  });

  it("stops on a neutral finding: the product question is the point of the gate", () => {
    const decision = decideBlocking({ ...base, direction: "neutral" });
    expect(decision.outcome).toBe("blocks");
    expect(decision.blocking).toBe(true);
  });

  it("keeps the d056 outcome on unsure or missing direction — the gate never widens on a hedge", () => {
    expect(decideBlocking({ ...base, direction: "unsure" }).outcome).toBe("blocks");
    expect(decideBlocking({ ...base, direction: null }).outcome).toBe("blocks");
  });

  it("stops security and context findings whatever the direction (the owner's ruling)", () => {
    expect(
      decideBlocking({ ...base, rule_id: "security.token_never_expires", direction: "negative" })
        .outcome,
    ).toBe("blocks");
    expect(
      decideBlocking({ ...base, rule_id: "context.injected_instruction", direction: "negative" })
        .outcome,
    ).toBe("blocks");
  });

  it("blocks on the last round: the human turn is deferred, never removed", () => {
    const decision = decideBlocking({
      ...base,
      direction: "negative",
      remediation_available: false,
    });
    expect(decision.outcome).toBe("blocks");
  });

  it("routes the contract row regardless of closure: an unmet criterion is negative by construction", () => {
    const decision = decideBlocking({
      ...base,
      row: "contract",
      rule_id: "criterion.not_met",
      closure: "human",
    });
    expect(decision.outcome).toBe("remediable");
  });

  it("routes the verification row regardless of closure: absent evidence has a known direction", () => {
    const decision = decideBlocking({
      ...base,
      row: "verification_strength",
      rule_id: "criterion.unverified",
      closure: "human",
    });
    expect(decision.outcome).toBe("remediable");
  });

  it("leaves ordinary semantic findings advisory — the fix path widens stopping findings only", () => {
    const decision = decideBlocking({
      ...base,
      row: "semantic_ordinary",
      risk_level: "P1",
      direction: "negative",
    });
    expect(decision.outcome).toBe("advisory");
  });

  it("changes nothing when scored under d056 — the old rule replays exactly", () => {
    const decision = decideBlocking({ ...base, direction: "negative", policy: "d056" });
    expect(decision.outcome).toBe("blocks");
    const contract = decideBlocking({
      ...base,
      row: "contract",
      rule_id: "criterion.not_met",
      closure: "human",
      policy: "d056",
    });
    expect(contract.outcome).toBe("blocks");
  });

  it("still never routes a deterministic finding", () => {
    const decision = decideBlocking({
      ...base,
      row: "deterministic",
      rule_id: "scope.escape",
      confidence: null,
      closure: null,
      direction: null,
    });
    expect(decision.outcome).toBe("blocks");
  });
});
