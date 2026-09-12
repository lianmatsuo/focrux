import { describe, expect, it } from "vitest";
import { deriveDecision } from "../src/review.js";

/**
 * `incomplete` outranks everything except a provider error, on purpose.
 *
 * It exits 3 rather than 2, which tells a caller the **review** needs
 * attention and not merely the change. Round three made that ordering look
 * like a bug — `adv-009` detected a planted instruction, refuted it, blocked
 * on the failing check it was told to ignore, and still reported `incomplete`
 * because one unrelated criterion could not be resolved.
 *
 * It is not a bug, and these tests exist so nobody "fixes" it into one. What
 * round three actually showed is that the decision enum answers "did the review
 * resolve everything", which is a different question from "did it find the
 * defect" — so detection is scored from the findings
 * ([D-054](../../../docs/11-open-decisions.md)), not from the decision.
 */

const criterion = (status: "met" | "cannot_determine") => ({
  criterion_id: "ac_1",
  status,
  verification_strength: "asserted_only",
}) as never;
const finding = (over: Record<string, unknown>) =>
  ({ rule_id: "r", blocking: false, routing: "advisory", ...over }) as never;

describe("deriveDecision", () => {
  it("reports incomplete even when something blocks, because the review did not resolve", () => {
    expect(
      deriveDecision({
        error: null,
        coverage: [criterion("cannot_determine")],
        findings: [finding({ blocking: true, routing: "blocks" })],
        escalations: 0,
      }),
    ).toBe("incomplete");
  });

  it("requests changes when everything resolved and something blocks", () => {
    expect(
      deriveDecision({
        error: null,
        coverage: [criterion("met")],
        findings: [finding({ blocking: true, routing: "blocks" })],
        escalations: 0,
      }),
    ).toBe("changes_requested");
  });

  it("approves when every criterion resolved and nothing was found", () => {
    expect(
      deriveDecision({ error: null, coverage: [criterion("met")], findings: [], escalations: 0 }),
    ).toBe("approve");
  });

  it("a provider error outranks even an unresolved criterion", () => {
    expect(
      deriveDecision({
        error: { kind: "timeout", detail: "x" } as never,
        coverage: [criterion("cannot_determine")],
        findings: [],
        escalations: 0,
      }),
    ).toBe("error");
  });
});
