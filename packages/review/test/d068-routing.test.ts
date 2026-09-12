import { describe, expect, it } from "vitest";
import { decideBlocking, type BlockingInput } from "../src/blocking.js";

/**
 * d068: a legibility block the executor itself caused goes back to it once.
 *
 * The finding is deterministic — no reviewer confidence, no closure answer —
 * and every other deterministic finding still stops. What opens the one round
 * is the pair the reviewer can establish without judgement: the illegible
 * bytes are on a line or in a file this change added or modified. The review
 * runs once; the round after it is verified, and the verifier is what stops a
 * change that is still illegible.
 */
const nul: BlockingInput = {
  row: "deterministic",
  rule_id: "legibility.control_character_in_source",
  criterion_id: null,
  confidence: null,
  risk_level: "P2",
  rule_demoted: false,
  waived: false,
  closure: null,
  direction: null,
  remediation_available: true,
  policy: "d068",
  caused_by_change: true,
};

describe("d068: a legibility block the change itself caused is routed once", () => {
  it("routes a NUL on an added line to the executor on the first round", () => {
    const decision = decideBlocking(nul);
    expect(decision.outcome).toBe("remediable");
    expect(decision.blocking).toBe(false);
    expect(decision.reason).toContain("legibility");
  });

  it("routes an unrenderable file the change added the same way", () => {
    expect(decideBlocking({ ...nul, rule_id: "legibility.unrenderable_file" }).outcome).toBe("remediable");
  });

  it("routes a NUL the reviewer hit in a file the change touched", () => {
    expect(decideBlocking({ ...nul, rule_id: "legibility.nul_byte_in_file" }).outcome).toBe("remediable");
  });

  it("stops where the illegible file is not the change's own", () => {
    expect(decideBlocking({ ...nul, caused_by_change: false }).outcome).toBe("blocks");
    expect(decideBlocking({ ...nul, caused_by_change: undefined }).outcome).toBe("blocks");
  });

  it("stops where no round is left to route into", () => {
    expect(decideBlocking({ ...nul, remediation_available: false }).outcome).toBe("blocks");
  });

  it("leaves every other deterministic finding a stop", () => {
    for (const rule_id of ["scope.escape", "check.failed", "security.forged_artifact"]) {
      expect(decideBlocking({ ...nul, rule_id }).outcome).toBe("blocks");
    }
  });

  it("is d068's rule, not d067's: the same input stops under the policy before it", () => {
    expect(decideBlocking({ ...nul, policy: "d067" }).outcome).toBe("blocks");
  });
});
