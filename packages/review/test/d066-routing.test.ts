import { describe, expect, it } from "vitest";
import { decideBlocking, type BlockingInput } from "../src/blocking.js";

/**
 * D-081 (SCP-247). Two things change under `d066`, and nothing else does.
 *
 * A semantic finding on a P1 change that carries a criterion id, a routable
 * closure and the reviewer's affirmative `negative` routes to the executor, as
 * it does on a P2 or P3 change: the finding names work the plan already
 * states, and the person is not shown what the executor can close.
 *
 * An `evidence.*` finding is advisory on its own: the process remark is not a
 * defect in the change.
 */

const p1Criterion: BlockingInput = {
  row: "semantic_ordinary",
  rule_id: "criterion.unverified",
  criterion_id: "ac_2",
  confidence: 0.9,
  risk_level: "P1",
  rule_demoted: false,
  waived: false,
  closure: "executor",
  direction: "negative",
  remediation_available: true,
  policy: "d066",
};

const evidenceAtP2: BlockingInput = {
  row: "semantic_high_risk",
  rule_id: "evidence.non_discriminating_assertion",
  criterion_id: "ac_1",
  confidence: 0.95,
  risk_level: "P2",
  rule_demoted: false,
  waived: false,
  closure: "executor",
  direction: "negative",
  remediation_available: true,
  policy: "d066",
};

describe("d066: a P1 finding that names its criterion is routed", () => {
  it("routes remediable on a P1 change with a criterion id, a routable closure and a negative direction", () => {
    expect(decideBlocking(p1Criterion).outcome).toBe("remediable");
  });

  it("routes an `unclear` closure the same way: uncertainty resolves toward the executor", () => {
    expect(decideBlocking({ ...p1Criterion, closure: "unclear" }).outcome).toBe("remediable");
  });

  it("stays advisory where a human must decide", () => {
    expect(decideBlocking({ ...p1Criterion, closure: "human" }).outcome).toBe("advisory");
  });

  it("stays advisory without a criterion id: nothing the plan states names the work", () => {
    expect(decideBlocking({ ...p1Criterion, criterion_id: null }).outcome).toBe("advisory");
  });

  it("stays advisory without a negative direction", () => {
    expect(decideBlocking({ ...p1Criterion, direction: "neutral" }).outcome).toBe("advisory");
    expect(decideBlocking({ ...p1Criterion, direction: null }).outcome).toBe("advisory");
  });

  it("stays advisory on the last round, not blocking: a P1 semantic finding never closed the gate", () => {
    expect(decideBlocking({ ...p1Criterion, remediation_available: false }).outcome).toBe("advisory");
  });

  it("replays d065 exactly: the same finding was advisory before", () => {
    expect(decideBlocking({ ...p1Criterion, policy: "d065" }).outcome).toBe("advisory");
  });
});

describe("d066: an evidence finding is advisory on its own", () => {
  it("is advisory at P2 where d065 routed it", () => {
    expect(decideBlocking(evidenceAtP2).outcome).toBe("advisory");
    expect(decideBlocking({ ...evidenceAtP2, policy: "d065" }).outcome).toBe("remediable");
  });

  it("never blocks, whatever the closure and confidence", () => {
    const decision = decideBlocking({ ...evidenceAtP2, closure: "human", confidence: 1 });
    expect(decision.outcome).toBe("advisory");
    expect(decision.blocking).toBe(false);
  });

  it("is advisory at P3 on the last round too", () => {
    expect(
      decideBlocking({ ...evidenceAtP2, risk_level: "P3", remediation_available: false }).outcome,
    ).toBe("advisory");
  });

  it("does not reach the deterministic row: a failing check still blocks", () => {
    expect(
      decideBlocking({ ...evidenceAtP2, row: "deterministic", rule_id: "check.unit_failed" }).outcome,
    ).toBe("blocks");
  });
});

describe("d066 keeps d065 everywhere else", () => {
  it("still stops security and context findings", () => {
    for (const rule_id of ["security.plaintext_secret", "context.injected_instruction"]) {
      expect(decideBlocking({ ...evidenceAtP2, rule_id }).outcome).toBe("blocks");
    }
  });

  it("still routes a neutral P2 semantic finding to the executor", () => {
    expect(
      decideBlocking({ ...evidenceAtP2, rule_id: "behaviour.incidental_change", direction: "neutral" })
        .outcome,
    ).toBe("remediable");
  });

  it("still blocks a P2 semantic finding on the last round", () => {
    expect(
      decideBlocking({
        ...evidenceAtP2,
        rule_id: "behaviour.incidental_change",
        remediation_available: false,
      }).outcome,
    ).toBe("blocks");
  });
});
