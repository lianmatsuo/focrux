import { z } from "zod";

/**
 * Which credential path GitHub was read through (SCP-200).
 *
 * A machine has one `gh` login, and every process on it shares that one file.
 * Four agents and a `sync` running `gh` at once left `~/.config/gh/hosts.yml`
 * three bytes long and the machine signed out of GitHub, with no command able
 * to say what had happened. So the path is decided before the read and written
 * down beside what the read returned.
 *
 * `GH_TOKEN` names the path, not the variable: `gh` reads `GH_TOKEN` first and
 * `GITHUB_TOKEN` after it, and a process holding either takes its credential
 * from its own environment and touches no shared file. `gh_login` is the
 * machine's stored login, which is the shared file.
 */
export const GITHUB_CREDENTIALS = ["GH_TOKEN", "gh_login"] as const;
export const GithubCredentialSchema = z.enum(GITHUB_CREDENTIALS);
export type GithubCredential = z.infer<typeof GithubCredentialSchema>;

/**
 * The words every refusal for a machine with neither carries.
 *
 * One phrase, so that a person who has read it once can search for it, and so
 * that "there is no credential" never again reads like "there is no pull
 * request" — which is what a `gh` failure looked like from the outside.
 */
export const GH_NOT_LOGGED_IN = "gh is not logged in";

/**
 * The conclusions that are a green check. A skipped or neutral one is not a
 * failure.
 *
 * Uppercase because that is how `gh` reports both halves of the status rollup:
 * a check run's `conclusion`, and a legacy status context's `state`.
 */
export const GREEN_CHECK_CONCLUSIONS = ["SUCCESS", "NEUTRAL", "SKIPPED"] as const;

/**
 * The conclusion recorded for a check that had none when the reader stopped
 * waiting.
 *
 * It is a value, not an absence, because the two say different things to
 * somebody reading the record: a check with no conclusion recorded may never
 * have been asked about, and this one was asked about and had not finished.
 */
export const UNCHECKED = "unchecked";

/** One check on a delivered head: its name, and what it concluded. */
export const DeliveredCheckSchema = z.strictObject({
  name: z.string().min(1),
  /** `gh`'s own word for it, lowercased, or {@link UNCHECKED}. */
  conclusion: z.string().min(1),
});
export type DeliveredCheck = z.infer<typeof DeliveredCheckSchema>;

/**
 * What the checks on a delivered head add up to.
 *
 * `checks_failed` is the one that changes what the delivery is: a head whose
 * checks are red is a delivery that failed on them, whatever the review said
 * about the change. `unchecked` is not a pass — nothing concluded before the
 * reader stopped waiting, or the head carries no check at all, and neither is
 * evidence that anything passed.
 */
export const DELIVERY_CHECK_STATES = ["green", "checks_failed", "unchecked"] as const;
export const DeliveryChecksStateSchema = z.enum(DELIVERY_CHECK_STATES);
export type DeliveryChecksState = z.infer<typeof DeliveryChecksStateSchema>;

/** Whether a conclusion is one of {@link GREEN_CHECK_CONCLUSIONS}. */
export const checkIsGreen = (conclusion: string | null): boolean =>
  conclusion !== null && GREEN_CHECK_CONCLUSIONS.includes(conclusion.toUpperCase() as never);

/**
 * What a set of read conclusions adds up to. Fails closed in both directions:
 * a head with no check at all is `unchecked` rather than green, and one
 * unfinished check leaves the whole reading `unchecked` rather than green.
 */
export function deliveryChecksState(checks: readonly DeliveredCheck[]): DeliveryChecksState {
  if (checks.some((check) => !checkIsGreen(check.conclusion) && check.conclusion !== UNCHECKED)) {
    return "checks_failed";
  }
  if (checks.length === 0 || checks.some((check) => check.conclusion === UNCHECKED)) return "unchecked";
  return "green";
}

/** The checks that are neither green nor still running: what makes a delivery red. */
export const failedChecks = (checks: readonly DeliveredCheck[]): DeliveredCheck[] =>
  checks.filter((check) => !checkIsGreen(check.conclusion) && check.conclusion !== UNCHECKED);
