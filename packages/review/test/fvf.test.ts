import { describe, expect, it } from "vitest";
import type { CheckResult } from "@focrux/contracts";
import { NEVER_REMEDIATED_FAMILIES } from "../src/blocking.js";
import { evaluateCounterfactual, isFiltered, type FvfEvidence } from "../src/fvf.js";

const check = (id: string, status: CheckResult["status"]): CheckResult => ({
  check_id: id,
  name: id,
  kind: "unit",
  status,
  summary: `${id} ${status}`,
  command: "pnpm test",
  detail: null,
  duration_ms: 10,
  source: "file",
});

const base = (over: Partial<FvfEvidence> = {}): FvfEvidence => ({
  rule_id: "durability.in_process_only",
  original_checks: [check("check_ut", "passed")],
  patched_checks: [check("check_ut", "passed")],
  counterfactual_tests: null,
  // Default: the fix touched source, so a non-discriminating result means the
  // finding was empty rather than satisfied.
  fix: { files: ["src/a.ts"], test_files: [] },
  ...over,
});

describe("the Fix-guided Verification Filter's decision core (SCP-102)", () => {
  it("keeps a finding whose fix flips a declared check", () => {
    const verdict = evaluateCounterfactual(
      base({ patched_checks: [check("check_ut", "failed")] }),
    );
    expect(verdict.action).toBe("kept");
    expect(verdict.reason).toContain("check_ut");
  });

  it("keeps a finding whose fix's own tests fail against the original tree", () => {
    const verdict = evaluateCounterfactual(
      base({ counterfactual_tests: { ran: true, failed_on_original: true } }),
    );
    expect(verdict.action).toBe("kept");
  });

  it("drops only on affirmative evidence: a source fix whose tests pass on the original too", () => {
    const verdict = evaluateCounterfactual(
      base({
        counterfactual_tests: { ran: true, failed_on_original: false },
        fix: { files: ["src/a.ts", "test/a.test.ts"], test_files: ["test/a.test.ts"] },
      }),
    );
    expect(verdict.action).toBe("dropped");
    expect(verdict.reason).toContain("do not discriminate");
  });

  it("keeps a finding whose fix produced no tests at all — nothing proves it empty", () => {
    const verdict = evaluateCounterfactual(base());
    expect(verdict.action).toBe("kept");
    expect(verdict.reason).toContain("absence of evidence");
  });

  it("refuses to drop a never-remediated family at any evidence", () => {
    for (const family of NEVER_REMEDIATED_FAMILIES) {
      const verdict = evaluateCounterfactual(base({ rule_id: `${family}.anything_at_all` }));
      expect(verdict.action).toBe("kept");
      expect(verdict.reason).toContain("never filtered");
    }
  });

  it("keeps, not drops, when the counterfactual could not run — absence of evidence", () => {
    const verdict = evaluateCounterfactual(
      base({ counterfactual_tests: { ran: false, failed_on_original: false } }),
    );
    expect(verdict.action).toBe("kept");
    expect(verdict.reason).toContain("could not run");
  });

  it("a check present only on one side is a difference, not an error", () => {
    const verdict = evaluateCounterfactual(
      base({ patched_checks: [check("check_ut", "passed"), check("check_new", "passed")] }),
    );
    expect(verdict.action).toBe("kept");
  });

  it("a tests-only fix that passes on both trees is closed by evidence, not dropped (SCP-104)", () => {
    // cln-002's shape: the finding asked for evidence, the executor wrote it,
    // and it passes at head because the change was correct all along.
    const verdict = evaluateCounterfactual(
      base({
        rule_id: "criterion.not_met",
        counterfactual_tests: { ran: true, failed_on_original: false },
        fix: { files: ["test/writer.test.ts"], test_files: ["test/writer.test.ts"] },
      }),
    );
    expect(verdict.action).toBe("closed_by_evidence");
    expect(verdict.reason).toContain("correct");
    // Criterion 2: the closure is auditable — the tests carrying it are named.
    expect(verdict.evidence_files).toEqual(["test/writer.test.ts"]);
  });

  it("both filtered dispositions leave a finding non-blocking; kept does not (SCP-104 criterion 3)", () => {
    const closed = evaluateCounterfactual(
      base({
        counterfactual_tests: { ran: true, failed_on_original: false },
        fix: { files: ["test/a.test.ts"], test_files: ["test/a.test.ts"] },
      }),
    );
    const dropped = evaluateCounterfactual(
      base({
        counterfactual_tests: { ran: true, failed_on_original: false },
        fix: { files: ["src/a.ts", "test/a.test.ts"], test_files: ["test/a.test.ts"] },
      }),
    );
    const kept = evaluateCounterfactual(base({ patched_checks: [check("check_ut", "failed")] }));
    expect(isFiltered(closed)).toBe(true);
    expect(isFiltered(dropped)).toBe(true);
    expect(isFiltered(kept)).toBe(false);
  });

  it("a tests-only fix whose tests FAIL on the original is kept — it discriminates", () => {
    const verdict = evaluateCounterfactual(
      base({
        counterfactual_tests: { ran: true, failed_on_original: true },
        fix: { files: ["test/a.test.ts"], test_files: ["test/a.test.ts"] },
      }),
    );
    expect(verdict.action).toBe("kept");
  });
});
