import { z } from "zod";
import { CheckIdSchema } from "./ids.js";

export const CHECK_KINDS = [
  "typecheck",
  "unit",
  "integration",
  "lint",
  "secret-scan",
  "dependency",
  "licence",
  "migration",
  "policy",
  "scope",
  /**
   * The change's own tests, run against the **base** commit.
   *
   * The status is inverted relative to every other kind, deliberately:
   * `passed` means the tests *failed* without the change, which is the evidence
   * that they discriminate, and `failed` means they passed without it and
   * therefore prove nothing. Encoding it this way keeps "passed is good" true
   * of every kind the reviewer sees — a literal `failed` here would be a
   * measurement that outranks the reviewer and make it block a change for
   * carrying exactly the evidence it asked for.
   */
  "regression-baseline",
  "other",
] as const;
export const CheckKindSchema = z.enum(CHECK_KINDS);
export type CheckKind = (typeof CHECK_KINDS)[number];

/**
 * `skipped` is a first-class status and never counts as evidence. A check that
 * skips itself when a dependency is missing reads green and means nothing, so
 * it must be distinguishable from one that ran and passed.
 */
export const CHECK_STATUSES = ["passed", "failed", "errored", "skipped"] as const;
export const CheckStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/**
 * The second run of a check that failed, on its own.
 *
 * `scope` says what ran: `files` narrowed the run to the failing test files in
 * the package that owns them, `task` re-ran the check's whole command because
 * the files could not be named or placed. `note` carries which of those it was
 * when the run was not narrowed.
 */
export const CheckRerunSchema = z.strictObject({
  command: z.string().min(1),
  scope: z.enum(["files", "task"]),
  note: z.string().min(1).nullable().default(null),
  status: CheckStatusSchema,
  summary: z.string(),
  failing_tests: z.array(z.string().min(1)).default([]),
  duration_ms: z.number().int().min(0).nullable().default(null),
});
export type CheckRerun = z.infer<typeof CheckRerunSchema>;

export const CheckResultSchema = z.strictObject({
  check_id: CheckIdSchema,
  name: z.string().min(1),
  kind: CheckKindSchema,
  status: CheckStatusSchema,
  /** Shown in the human rendering: "0 errors", "184 passed". */
  summary: z.string(),
  command: z.string().nullable().default(null),
  detail: z.string().nullable().default(null),
  duration_ms: z.number().int().min(0).nullable().default(null),
  /**
   * `file` — supplied by the caller in `checks.json`.
   * `computed` — derived here from the plan and the diff. Scope enforcement is
   * computed rather than accepted, because it must be perfect and is not a
   * model task (docs/04, "Monorepo scope enforcement").
   */
  source: z.enum(["file", "computed"]).default("file"),
  /**
   * Where the check came from: `configured` — the repository's own
   * `.focrux/config.json` — or `proposed`, derived from the scripts
   * `package.json` declares because that file does not exist yet (SCP-259).
   *
   * Absent means configured: a record written before the field existed parses
   * unchanged, and only the derived case has anything to say.
   */
  origin: z.enum(["configured", "proposed"]).optional(),
  /**
   * The tests that failed, parsed from the command's own captured output —
   * test file plus test name where the runner's marker carries one.
   *
   * The four fields below are `optional` rather than defaulted, and absent
   * means "not measured" rather than "measured and empty": a record written
   * before they existed parses unchanged, and a check computed rather than run
   * (scope, agent configuration) has no run to measure.
   */
  failing_tests: z.array(z.string().min(1)).optional(),
  /** How many times the check ran again after its first failure. At most one. */
  reruns: z.number().int().min(0).optional(),
  /** The check failed, and passed when its failing tests were run again alone. */
  flaky: z.boolean().optional(),
  /** The re-run's own record. Absent on a check that was not re-run. */
  rerun: CheckRerunSchema.nullable().optional(),
  /**
   * The temporary directory the command ran under (`TMPDIR`), `null` when the
   * runner had none to give it.
   *
   * A check that behaves differently in the loop and in a clean checkout is
   * usually reading a directory the two do not share, and this is what makes
   * that readable off the record instead of reproducible only by rerunning.
   */
  tmpdir: z.string().min(1).nullable().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const CheckResultsFileSchema = z.union([
  z.array(CheckResultSchema),
  z.strictObject({ checks: z.array(CheckResultSchema) }).transform((value) => value.checks),
]);

export function checkPassed(check: CheckResult): boolean {
  return check.status === "passed";
}

/** Anything that is not an unambiguous pass, including `skipped`. */
export function checkIsFailureOrAbsent(check: CheckResult): boolean {
  return check.status !== "passed";
}
