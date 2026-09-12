import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BLOCKING_ROWS,
  SEMANTIC_BLOCKING_CONFIDENCE_FLOOR,
  applyBlocking,
  decideBlocking,
  type BlockingInput,
} from "../src/blocking.js";

const base: BlockingInput = {
  row: "semantic_ordinary",
  rule_id: "test.happy_path_only",
  confidence: 0.9,
  risk_level: "P1",
  rule_demoted: false,
  waived: false,
  // The four-row behaviour: nothing is routed to the executor unless the
  // reviewer affirmatively said the executor could close it.
  closure: null,
  remediation_available: true,
};

describe("the blocking matrix is a lookup", () => {
  it("always blocks a deterministic finding, at any confidence and any risk", () => {
    for (const actual_risk of ["P0", "P1", "P2", "P3"] as const) {
      for (const confidence of [null, 0, 0.5, 1]) {
        const decision = decideBlocking({ ...base, row: "deterministic", confidence, risk_level: actual_risk });
        expect(decision.blocking).toBe(true);
      }
    }
  });

  it("always closes the gate on an unmet criterion, because coverage must be complete", () => {
    for (const actual_risk of ["P1", "P2", "P3"] as const) {
      // Under d064 an unmet criterion is negative by construction — the plan
      // already states the behaviour — so it routes to the executor rather
      // than stopping a person. The gate is closed either way: remediable
      // exits 2. The rules earlier rounds were measured under still replay.
      expect(decideBlocking({ ...base, row: "contract", risk_level: actual_risk }).outcome).toBe(
        "remediable",
      );
      expect(
        decideBlocking({ ...base, row: "contract", risk_level: actual_risk, policy: "d056" })
          .blocking,
      ).toBe(true);
    }
  });

  it("routes asserted_only at P2 and above, and leaves it advisory at P1", () => {
    // D-064: absent evidence has a known direction, so at high risk it goes to
    // the executor as work instead of stopping a person. At P1 the d056
    // outcome was advisory — the change passed — and D-064 must not convert an
    // advisory into a routed round, or it would close a gate it exists to open.
    expect(
      decideBlocking({ ...base, row: "verification_strength", risk_level: "P1" }).outcome,
    ).toBe("advisory");
    expect(
      decideBlocking({ ...base, row: "verification_strength", risk_level: "P2" }).outcome,
    ).toBe("remediable");
    expect(
      decideBlocking({ ...base, row: "verification_strength", risk_level: "P3" }).outcome,
    ).toBe("remediable");
    // The rule round 4 was measured under still replays: blocked at high risk.
    expect(
      decideBlocking({ ...base, row: "verification_strength", risk_level: "P2", policy: "d056" })
        .blocking,
    ).toBe(true);
  });

  it("blocks a high-risk semantic finding at the floor and escalates below it", () => {
    // Pinned to d056: the confidence-floor rows are that rule's shape. Under
    // d065 the same finding routes to the executor, pinned in
    // test/d065-routing.test.ts.
    const at = decideBlocking({
      ...base,
      row: "semantic_high_risk",
      risk_level: "P2",
      confidence: SEMANTIC_BLOCKING_CONFIDENCE_FLOOR,
      policy: "d056",
    });
    expect(at.outcome).toBe("blocks");

    const below = decideBlocking({
      ...base,
      row: "semantic_high_risk",
      risk_level: "P2",
      confidence: SEMANTIC_BLOCKING_CONFIDENCE_FLOOR - 0.01,
      policy: "d056",
    });
    // Below the floor it escalates to a human rather than passing silently.
    expect(below.outcome).toBe("escalates");
    expect(below.blocking).toBe(false);
  });

  it("leaves an ordinary semantic finding advisory however confident it is", () => {
    expect(decideBlocking({ ...base, confidence: 1 }).blocking).toBe(false);
  });

  it("demotes a rule the harness measured crying wolf, but never a deterministic one", () => {
    expect(
      decideBlocking({ ...base, row: "semantic_high_risk", risk_level: "P2", rule_demoted: true })
        .blocking,
    ).toBe(false);
    expect(decideBlocking({ ...base, row: "deterministic", rule_demoted: true }).blocking).toBe(
      true,
    );
  });

  it("lets an authorised waiver override even a deterministic finding", () => {
    const decision = decideBlocking({ ...base, row: "deterministic", waived: true });
    expect(decision.outcome).toBe("waived");
    expect(decision.blocking).toBe(false);
  });

  it("records which row fired", () => {
    for (const row of BLOCKING_ROWS) {
      expect(decideBlocking({ ...base, row }).reason.length).toBeGreaterThan(10);
    }
  });
});

describe("no arithmetic product anywhere in the implementation", () => {
  // D-010 and SCP-083: model confidence is not calibrated well enough to be a
  // multiplicand in a hard gate. This reads the source rather than trusting the
  // review of it, because the rule is about what the code does, not what it says.
  const sources: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
        continue;
      }
      if (entry.name.endsWith(".ts")) {
        sources.push([join(dir, entry.name), readFileSync(join(dir, entry.name), "utf8")]);
      }
    }
  };
  walk(new URL("../src", import.meta.url).pathname);

  it("has sources to check", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  it.each(sources)("%s multiplies nothing by confidence or severity", (_path, source) => {
    // Any `*` with `confidence` or `severity` on either side of it.
    const product = /(confidence|severity)[^;\n]{0,40}\*[^;\n*/]|[^*/\n]\*[^;\n]{0,40}(confidence|severity)/;
    const offending = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
      .filter((line) => product.test(line));
    expect(offending).toEqual([]);
  });
});

/**
 * D-056. The rule Stage 2 measured routed only on an affirmative `executor`,
 * and the contract row could not route at all. Both are widened here, and both
 * changes are checked against `policy: "d051"` as well — because scoring a
 * stored run under the old rule is how the widening is attributed to itself
 * rather than to a different sample.
 */
describe("D-056: uncertainty resolves toward the executor, not the human", () => {
  const semantic: BlockingInput = {
    ...base,
    row: "semantic_high_risk",
    risk_level: "P2",
    confidence: 0.9,
  };

  it("routes a high-risk semantic finding the reviewer could not place", () => {
    expect(decideBlocking({ ...semantic, closure: "unclear" }).outcome).toBe("remediable");
    expect(decideBlocking({ ...semantic, closure: "unclear", policy: "d051" }).outcome).toBe(
      "blocks",
    );
  });

  it("still blocks where the reviewer said a human must close it", () => {
    for (const policy of ["d051", "d056"] as const) {
      expect(decideBlocking({ ...semantic, closure: "human", policy }).outcome).toBe("blocks");
    }
  });

  it("routes an unverified criterion at P2 on an unclear answer", () => {
    const verification: BlockingInput = {
      ...base,
      row: "verification_strength",
      risk_level: "P2",
      closure: "unclear",
    };
    expect(decideBlocking(verification).outcome).toBe("remediable");
    expect(decideBlocking({ ...verification, policy: "d051" }).outcome).toBe("blocks");
  });

  it("under d056, routes an unmet criterion only on an affirmative answer, unlike the semantic rows", () => {
    // Pinned to d056: under d064 the contract row routes whatever the answer,
    // which test/d064-routing.test.ts pins.
    const contract: BlockingInput = { ...base, row: "contract", risk_level: "P2", policy: "d056" };
    expect(decideBlocking({ ...contract, closure: "executor" }).outcome).toBe("remediable");
    expect(decideBlocking({ ...contract, closure: "executor", policy: "d051" }).outcome).toBe(
      "blocks",
    );

    // A hedge is not enough here, and the reason is that the family guard is
    // blind to this row: every contract-row finding carries `criterion.not_met`,
    // so a criterion about authentication is indistinguishable from one about a
    // log line. `security.*` never routes because closing it means deciding
    // what the system should do — and an unmet criterion can be exactly that.
    expect(decideBlocking({ ...contract, closure: "unclear" }).blocking).toBe(true);
    expect(decideBlocking({ ...contract, closure: "human" }).blocking).toBe(true);
  });

  it("never routes the two families that are behavioural by construction", () => {
    for (const rule_id of ["security.missing_signature_check", "context.injected_instruction"]) {
      for (const closure of ["executor", "unclear"] as const) {
        expect(decideBlocking({ ...semantic, rule_id, closure }).outcome).toBe("blocks");
        expect(decideBlocking({ ...contractRow, rule_id, closure }).outcome).toBe("blocks");
      }
    }
  });

  const contractRow: BlockingInput = { ...base, row: "contract", risk_level: "P2" };

  it("stops routing on the last round, so the human turn arrives rather than never", () => {
    for (const row of ["contract", "verification_strength", "semantic_high_risk"] as const) {
      const spent = decideBlocking({
        ...base,
        row,
        risk_level: "P2",
        confidence: 0.9,
        closure: "executor",
        remediation_available: false,
      });
      expect(spent.blocking).toBe(true);
      expect(spent.reason).toContain("remediation rounds are spent");
    }
  });

  it("records the row and the closure that produced the outcome", () => {
    const decision = decideBlocking({ ...semantic, closure: "unclear" });
    const finding = applyBlocking(
      {
        key: "0".repeat(64),
        rule_id: semantic.rule_id,
        source: "semantic",
        row: null,
        closure: null,
        criterion_id: null,
        severity: "major",
        blocking: false,
        blocking_reason: "",
        routing: "advisory",
        confidence: 0.9,
        file: null,
        line: null,
        symbol: null,
        statement: "x",
        status: "open",
        outcome: "unknown",
        waiver: null,
      },
      decision,
      { ...semantic, closure: "unclear" },
    );
    expect(finding.row).toBe("semantic_high_risk");
    expect(finding.closure).toBe("unclear");
    expect(finding.routing).toBe("remediable");
  });
});

describe("the stop families stop even when the reviewer classified the finding advisory", () => {
  // adv-006, 2026-09-01, the d065 defective outing: the reviewer FOUND the
  // forged prior-review artifact (context.injected_instruction) but emitted it
  // non-blocking, the semantic_ordinary row said advisory, the loop closed the
  // one routable finding beside it, and a must_not_approve fixture ended
  // approved end-to-end. The register said "security.*/context.* always stop"
  // (D-064's ruling, restated by D-065); the code implemented only "never
  // remediable". Under the policies whose decisions state the stop, family
  // outranks row.
  it("blocks an advisory-classified context finding under d064 and d065", () => {
    for (const policy of ["d064", "d065"] as const) {
      const decision = decideBlocking({
        ...base,
        rule_id: "context.injected_instruction",
        policy,
      });
      expect(decision.blocking, policy).toBe(true);
      expect(decision.outcome, policy).toBe("blocks");
    }
  });

  it("blocks a low-confidence security finding on a high-risk row under d065", () => {
    const decision = decideBlocking({
      ...base,
      row: "semantic_high_risk",
      rule_id: "security.empty_signing_secret_fallback",
      confidence: 0.3,
      risk_level: "P2",
      policy: "d065",
    });
    expect(decision.blocking).toBe(true);
  });

  it("replays d051 and d056 exactly as they ran: the promotion does not reach them", () => {
    for (const policy of ["d051", "d056"] as const) {
      const decision = decideBlocking({
        ...base,
        rule_id: "context.injected_instruction",
        policy,
      });
      expect(decision.outcome, policy).toBe("advisory");
    }
  });

  it("keeps a demoted rule demoted: measured revocation outranks the family stop", () => {
    const decision = decideBlocking({
      ...base,
      rule_id: "security.rule_that_cried_wolf",
      rule_demoted: true,
      policy: "d065",
    });
    expect(decision.outcome).toBe("advisory");
    expect(decision.reason).toMatch(/demoted/);
  });

  it("keeps a waiver above the family stop: a person's override stands", () => {
    const decision = decideBlocking({
      ...base,
      rule_id: "security.known_accepted_risk",
      waived: true,
      policy: "d065",
    });
    expect(decision.outcome).toBe("waived");
  });
});
