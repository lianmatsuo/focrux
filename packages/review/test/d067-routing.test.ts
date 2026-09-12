import { describe, expect, it } from "vitest";
import { decideBlocking, type BlockingInput } from "../src/blocking.js";

/**
 * D-085. An evidence finding is a defect of the change's evidence: where the
 * executor can close it, it goes there, with no notice to the person, on every
 * row but the deterministic one. It never stops on its own — where it cannot
 * be closed it stays advisory. d066's clause, which made it advisory on its
 * own in every case, replays as it ran.
 */

const evidence: BlockingInput = {
  row: "semantic_high_risk",
  rule_id: "evidence.non_discriminating_assertion",
  criterion_id: "ac_1",
  confidence: 0.9,
  risk_level: "P2",
  rule_demoted: false,
  waived: false,
  closure: "executor",
  direction: "negative",
  remediation_available: true,
  policy: "d067",
};

describe("d067: an evidence finding the executor can close goes to it", () => {
  it("routes remediable at P2 and P3, and at P1 on the ordinary row", () => {
    expect(decideBlocking(evidence).outcome).toBe("remediable");
    expect(decideBlocking({ ...evidence, risk_level: "P3" }).outcome).toBe("remediable");
    expect(decideBlocking({ ...evidence, risk_level: "P1", row: "semantic_ordinary" }).outcome).toBe("remediable");
  });

  it("routes an `unclear` closure the same way", () => {
    expect(decideBlocking({ ...evidence, closure: "unclear" }).outcome).toBe("remediable");
  });

  it("routes with no direction answer too: the evidence's weakness is its direction", () => {
    expect(decideBlocking({ ...evidence, direction: null }).outcome).toBe("remediable");
  });

  it("routes a `human` closure as D-065 routes every other finding: the attempt is the discriminator", () => {
    expect(decideBlocking({ ...evidence, closure: "human" }).outcome).toBe("remediable");
  });

  it("routes at P1 with no criterion id, where an ordinary semantic finding would stay advisory", () => {
    const p1 = { ...evidence, risk_level: "P1" as const, row: "semantic_ordinary" as const, criterion_id: null };
    expect(decideBlocking(p1).outcome).toBe("remediable");
    expect(decideBlocking({ ...p1, rule_id: "behaviour.off_by_one" }).outcome).toBe("advisory");
  });

  it("leaves a demoted evidence rule advisory on every row, including the ones that would block a demoted rule", () => {
    for (const row of ["semantic_high_risk", "semantic_ordinary", "contract", "verification_strength"] as const) {
      for (const remediation_available of [true, false]) {
        const decision = decideBlocking({ ...evidence, row, rule_demoted: true, remediation_available });
        expect(decision.outcome, `${row}, last round ${!remediation_available}`).toBe("advisory");
        expect(decision.blocking).toBe(false);
      }
    }
    expect(decideBlocking({ ...evidence, rule_demoted: true, policy: "d066" }).outcome).toBe("advisory");
  });

  it("stays advisory on the last round, where a behavioural finding on the same row blocks: it never stops on its own", () => {
    const decision = decideBlocking({ ...evidence, remediation_available: false, confidence: 1 });
    expect(decision.outcome).toBe("advisory");
    expect(decision.blocking).toBe(false);
    expect(
      decideBlocking({ ...evidence, rule_id: "behaviour.off_by_one", remediation_available: false, confidence: 1 }).outcome,
    ).toBe("blocks");
  });

  it("does not reach the deterministic row", () => {
    expect(decideBlocking({ ...evidence, row: "deterministic", rule_id: "check.unit_failed" }).outcome).toBe("blocks");
  });

  it("replays d066 exactly: advisory on its own there", () => {
    expect(decideBlocking({ ...evidence, policy: "d066" }).outcome).toBe("advisory");
  });
});

describe("d067 keeps d066 everywhere else", () => {
  const p1Criterion: BlockingInput = {
    ...evidence,
    row: "semantic_ordinary",
    rule_id: "criterion.unverified",
    criterion_id: "ac_2",
    risk_level: "P1",
  };

  it("still routes a P1 finding that names its criterion", () => {
    expect(decideBlocking(p1Criterion).outcome).toBe("remediable");
    expect(decideBlocking({ ...p1Criterion, criterion_id: null }).outcome).toBe("advisory");
  });

  it("still stops security and context findings", () => {
    for (const rule_id of ["security.plaintext_secret", "context.injected_instruction"]) {
      expect(decideBlocking({ ...evidence, rule_id }).outcome).toBe("blocks");
    }
  });

  it("still blocks a behavioural P2 finding on the last round", () => {
    expect(
      decideBlocking({ ...evidence, rule_id: "behaviour.incidental_change", remediation_available: false }).outcome,
    ).toBe("blocks");
  });
});
