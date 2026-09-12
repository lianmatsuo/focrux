import { describe, expect, it } from "vitest";
import { decideBlocking, type BlockingInput } from "../src/blocking.js";

/**
 * D-065, fully decided: the attempt is the discriminator. Under `d065` every
 * stopping finding on a routable row goes to the executor — whatever the
 * direction answer, whatever the closure answer — and the executor either
 * finds the established practice and fixes, or declares that no determinable
 * practice exists, which is what stops for a person. The wobbly up-front
 * classification is gone; the stop is discovered by trying.
 *
 * What no policy changes: security.* and context.* stop, deterministic rows
 * stop, and the last round stops — the human turn is deferred, never removed.
 */

const base: BlockingInput = {
  row: "semantic_high_risk",
  rule_id: "behaviour.incidental_change",
  confidence: 0.9,
  risk_level: "P2",
  rule_demoted: false,
  waived: false,
  closure: "human",
  direction: "neutral",
  remediation_available: true,
  policy: "d065",
};

describe("d065: the attempt is the discriminator", () => {
  it("routes a neutral finding — the executor discovers whether a practice exists", () => {
    expect(decideBlocking(base).outcome).toBe("remediable");
  });

  it("routes whatever the direction and closure answers say", () => {
    for (const direction of ["negative", "neutral", "unsure", null] as const) {
      for (const closure of ["executor", "human", "unclear"] as const) {
        expect(decideBlocking({ ...base, direction, closure }).outcome).toBe("remediable");
      }
    }
  });

  it("still stops security and context findings", () => {
    expect(decideBlocking({ ...base, rule_id: "security.token_never_expires" }).outcome).toBe(
      "blocks",
    );
    expect(decideBlocking({ ...base, rule_id: "context.injected_instruction" }).outcome).toBe(
      "blocks",
    );
  });

  it("still blocks on the last round", () => {
    expect(decideBlocking({ ...base, remediation_available: false }).outcome).toBe("blocks");
  });

  it("leaves ordinary semantic findings advisory", () => {
    expect(
      decideBlocking({ ...base, row: "semantic_ordinary", risk_level: "P1" }).outcome,
    ).toBe("advisory");
  });

  it("replays d064 exactly: a neutral finding still blocked under the prior rule", () => {
    expect(decideBlocking({ ...base, policy: "d064" }).outcome).toBe("blocks");
  });
});
