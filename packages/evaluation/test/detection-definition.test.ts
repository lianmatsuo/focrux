import { describe, expect, it } from "vitest";
import { scoreRun } from "../src/score.js";
import { sample } from "./sample-fixtures.js";

/**
 * Detection is the finding being raised, not the gate staying shut (D-064).
 *
 * Before D-064 was ratified, `detected` was `closed && cited`: it required the
 * change to have been stopped. That inverts under the loop — a defect found,
 * routed, fixed and verified ends at `approve`, so the better the system works
 * the worse recall reads (stage-3-d064-safety-half.md). D-064 makes the loop
 * the normal path, so `detected` is now: **an attributable finding was
 * raised**, whether blocking or routed, however the gate ended.
 *
 * The pre-D-064 number is not discarded: `stopped` records `closed && raised`,
 * reported on every run so this round's recall can be read against every round
 * scored under the old definition.
 */

const fixture = () => {
  const found = sample.find((entry) => entry.fixture.id.startsWith("sec-006"));
  if (!found) throw new Error("sec-006 fixture missing");
  return found.fixture;
};

const artifact = (decision: string, ruleFile: string | null) =>
  ({
    decision,
    coverage: [],
    findings:
      ruleFile === null
        ? []
        : [
            {
              key: "k",
              rule_id: "security.idor",
              source: "semantic",
              blocking: decision === "changes_requested",
              routing: decision === "changes_requested" ? "blocks" : "remediable",
              criterion_id: null,
              file: ruleFile,
              statement: "s",
              severity: "blocker",
              confidence: 0.9,
            },
          ],
    actual_risk: "P2",
    escalated: false,
    cost_micros: 0,
  }) as never;

describe("detected means an attributable finding was raised (D-064)", () => {
  const anchored = "packages/files/src/download.ts";

  it("detects when the finding was raised and the gate closed", () => {
    const score = scoreRun(fixture(), artifact("changes_requested", anchored), 2);
    expect(score.detected).toBe(true);
    expect(score.stopped).toBe(true);
  });

  it("still detects when the loop closed the finding and the change was approved", () => {
    // What the loop produces end to end: the defect was raised, routed, fixed
    // and verified, so the change is approved. Under the old definition this
    // read as a recall miss however well the loop worked.
    const score = scoreRun(fixture(), artifact("approve", anchored), 0);
    expect(score.detected).toBe(true);
    expect(score.stopped).toBe(false);
  });

  it("does not detect when nothing attributable was raised, however the gate ended", () => {
    expect(scoreRun(fixture(), artifact("approve", null), 0).detected).toBe(false);
    const unrelated = scoreRun(fixture(), artifact("changes_requested", "src/unrelated.ts"), 2);
    expect(unrelated.detected).toBe(false);
    expect(unrelated.stopped).toBe(false);
  });

  it("does not credit a review that errored, however loud its findings", () => {
    // The old definition excluded errored reviews through its `closed` conjunct.
    // The redefinition keeps that exclusion deliberately: a crashed review is
    // not a detection, even when deterministic findings survived the crash —
    // otherwise a systematic crash-after-finding mode keeps recall green while
    // no review ever completes.
    const score = scoreRun(fixture(), artifact("error", anchored), 3);
    expect(score.detected).toBe(false);
    expect(score.stopped).toBe(false);
    expect(score.did_not_complete).toBe(true);
  });
});
