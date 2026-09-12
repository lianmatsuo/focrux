import type { CheckResult } from "@focrux/contracts";
import { NEVER_REMEDIATED_FAMILIES } from "./blocking.js";

/**
 * The Fix-guided Verification Filter's decision core (SCP-102, D-061).
 *
 * Method from Jin & Chen, arXiv:2603.00539: treat a proposed fix as an
 * executable counterfactual rather than reading its rationale. In D-061's flow
 * this runs on findings whose closure needs a person, *after* the executor has
 * attempted a minimal fix in a sandbox: if nothing any declared check observes
 * distinguishes the original tree from the patched one, the finding was about
 * nothing this repository can measure, and it is dropped rather than shown.
 *
 * This module is deliberately only the decision. Producing the evidence — the
 * sandboxed fix attempt, the check runs on both trees, applying the fix's own
 * tests to the original tree — belongs to the loop, which already owns
 * execution. Nothing here consults a model, and per the pre-registration
 * (stage-3-fvf-preregistration.md) every uncertainty resolves toward *kept*:
 * the filter exists to drop findings proven empty, never to thin a queue.
 */

export interface FvfEvidence {
  /** The finding's rule id; never-remediated families are never filtered. */
  rule_id: string;
  /** The pinned check set, run against the change as reviewed. */
  original_checks: CheckResult[];
  /** The same set, run after applying the executor's minimal fix. */
  patched_checks: CheckResult[];
  /**
   * The strong half of the counterfactual: the fix's own new or changed test
   * files applied alone to the original tree. `failed_on_original` true means
   * the fix demonstrably tests something the original does not do. `null` when
   * the loop did not produce this evidence (a fix with no test files).
   */
  counterfactual_tests: { ran: boolean; failed_on_original: boolean } | null;
  /**
   * What the executor's fix touched. The split matters (SCP-104): a fix that
   * only writes tests is *satisfying* a finding about weak evidence, while a
   * fix that changes source and still moves nothing observable is a finding
   * about nothing.
   */
  fix: { files: string[]; test_files: string[] };
}

export interface FvfVerdict {
  /**
   * `kept` — the finding stands and a person sees it.
   * `closed_by_evidence` — the finding asked for evidence, the executor wrote
   *   it, and it passes against the original tree too: the change was already
   *   correct in the only sense anything here can check. The reviewer was not
   *   wrong, so this is deliberately not called `dropped`.
   * `dropped` — the fix changed source and nothing observable distinguishes
   *   the trees, so no evidence supports the finding.
   *
   * Both non-`kept` values leave the finding non-blocking; ask `isFiltered`
   * rather than comparing to a literal, so the distinction stays reportable
   * without becoming a second gate.
   */
  action: "kept" | "closed_by_evidence" | "dropped";
  reason: string;
  /** For `closed_by_evidence`: the test files that now carry the closure. */
  evidence_files: string[];
}

/** Both filtered dispositions stop a finding blocking; only `kept` does not. */
export function isFiltered(verdict: FvfVerdict): boolean {
  return verdict.action !== "kept";
}

const family = (ruleId: string) => ruleId.split(".")[0] ?? ruleId;

export function evaluateCounterfactual(evidence: FvfEvidence): FvfVerdict {
  if (NEVER_REMEDIATED_FAMILIES.includes(family(evidence.rule_id) as never)) {
    return {
      action: "kept",
      evidence_files: [],
      reason:
        `${family(evidence.rule_id)}.* is never filtered: the family is refused remediation at ` +
        `any closure answer, and a guard the filter could empty is not a guard.`,
    };
  }

  if (evidence.counterfactual_tests !== null && !evidence.counterfactual_tests.ran) {
    return {
      action: "kept",
      evidence_files: [],
      reason:
        "the counterfactual could not run; absence of evidence keeps a finding, it never drops one.",
    };
  }

  const originalById = new Map(
    evidence.original_checks.map((check) => [check.check_id, check.status]),
  );
  const patchedById = new Map(evidence.patched_checks.map((check) => [check.check_id, check.status]));
  for (const [checkId, status] of patchedById) {
    const before = originalById.get(checkId);
    if (before === undefined || before !== status) {
      return {
        action: "kept",
        evidence_files: [],
        reason: `${checkId} distinguishes the trees (${before ?? "absent"} -> ${status}).`,
      };
    }
  }
  for (const checkId of originalById.keys()) {
    if (!patchedById.has(checkId)) {
      return {
        action: "kept",
        evidence_files: [],
        reason: `${checkId} distinguishes the trees (present -> absent).`,
      };
    }
  }

  if (evidence.counterfactual_tests?.failed_on_original) {
    return {
      action: "kept",
      evidence_files: [],
      reason:
        "the fix's own tests fail against the original tree: the finding names behaviour the " +
        "change does not have.",
    };
  }

  // Dropping requires affirmative evidence of emptiness: the fix's own tests
  // ran against the original tree and passed. A fix that produced no tests has
  // proven nothing either way, and absence of evidence keeps a finding — the
  // first run of the experiment violated this and dropped `api.unsafe_default`
  // on a source-only fix, which is recorded in its result.
  if (evidence.counterfactual_tests === null) {
    return {
      action: "kept",
      evidence_files: [],
      reason:
        "the fix produced no discriminating tests, so nothing proves the finding empty; " +
        "absence of evidence keeps a finding.",
    };
  }

  // SCP-104. A fix that touched only tests did not change the software: the
  // finding asked for evidence, the executor supplied it, and it passes on the
  // original tree — so the change was already correct in the only sense
  // anything here can check. Calling that `dropped` reads as "the reviewer was
  // wrong", which is the opposite of what happened.
  const sourceFiles = evidence.fix.files.filter((path) => !evidence.fix.test_files.includes(path));
  if (evidence.fix.test_files.length > 0 && sourceFiles.length === 0) {
    return {
      action: "closed_by_evidence",
      evidence_files: [...evidence.fix.test_files],
      reason:
        "the fix wrote only tests, and they pass against the original tree as well as the fixed " +
        "one: the finding asked for evidence, the evidence now exists, and it says the change was " +
        "correct. Closed by that evidence rather than dropped as empty.",
    };
  }

  return {
    action: "dropped",
    evidence_files: [],
    reason:
      "no declared check distinguishes the trees, and the fix's own tests pass against the " +
      "original as well as the fixed tree — affirmative evidence that they do not discriminate. " +
      "Nothing observable supports the finding.",
  };
}
