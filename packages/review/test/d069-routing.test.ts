import { describe, expect, it } from "vitest";
import { decideBlocking, type BlockingInput } from "../src/blocking.js";

/**
 * d069: a pinned check the executor itself broke goes back to it once.
 *
 * The finding is deterministic — no reviewer confidence, no closure answer —
 * and every other deterministic finding still stops. What opens the one round
 * is a fact the runner establishes without judgement: the check ran and
 * failed on the change's tree, and the base that tree was cut from had passed
 * the workspace's verify command. The review runs once; the round after it is
 * verified, and the verifier's own run of the pinned checks is what stops a
 * change whose check still fails.
 */
const failedUnit: BlockingInput = {
  row: "deterministic",
  rule_id: "check.unit",
  criterion_id: null,
  confidence: null,
  risk_level: "P2",
  rule_demoted: false,
  waived: false,
  closure: null,
  direction: null,
  remediation_available: true,
  policy: "d069",
  caused_by_change: true,
};

describe("d069: a pinned check the change itself broke is routed once", () => {
  it("routes a unit check that failed on a tree whose base verified", () => {
    const decision = decideBlocking(failedUnit);
    expect(decision.outcome).toBe("remediable");
    expect(decision.blocking).toBe(false);
    expect(decision.reason).toContain("check");
  });

  it("routes any pinned check kind the same way", () => {
    for (const rule_id of ["check.typecheck", "check.lint", "check.build"]) {
      expect(decideBlocking({ ...failedUnit, rule_id }).outcome).toBe("remediable");
    }
  });

  it("stops where the base did not verify, or nobody said", () => {
    expect(decideBlocking({ ...failedUnit, caused_by_change: false }).outcome).toBe("blocks");
    expect(decideBlocking({ ...failedUnit, caused_by_change: undefined }).outcome).toBe("blocks");
  });

  it("stops where no round is left to route into", () => {
    expect(decideBlocking({ ...failedUnit, remediation_available: false }).outcome).toBe("blocks");
  });

  it("leaves every other deterministic finding a stop", () => {
    for (const rule_id of ["scope.escape", "security.forged_artifact", "size.truncated"]) {
      expect(decideBlocking({ ...failedUnit, rule_id }).outcome).toBe("blocks");
    }
  });

  it("keeps d068's legibility route beside it", () => {
    expect(
      decideBlocking({ ...failedUnit, rule_id: "legibility.control_character_in_source" }).outcome,
    ).toBe("remediable");
  });

  it("is d069's rule, not d068's: the same input stops under the policy before it", () => {
    expect(decideBlocking({ ...failedUnit, policy: "d068" }).outcome).toBe("blocks");
  });
});
