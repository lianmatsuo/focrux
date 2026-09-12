/** A planning-time failure a person can act on: one sentence, no stack. */
export class PlanningError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlanningError";
  }
}

/**
 * The model returned something that is not a contract draft. Refused rather
 * than repaired: a draft this process had to guess at is not one a person can
 * meaningfully approve.
 */
export class DraftRejectedError extends PlanningError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `the model's draft is not a contract draft (${issues.length} issue${issues.length === 1 ? "" : "s"}): ` +
        issues.join("; "),
    );
    this.name = "DraftRejectedError";
    this.issues = issues;
  }
}
