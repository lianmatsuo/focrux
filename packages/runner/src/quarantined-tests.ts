/**
 * Tests known to fail under a loaded machine and not yet fixed (SCP-246).
 *
 * `runPinnedChecks` in `./checks.js` reads this list: a unit check whose
 * failing tests are all named here does not close the gate — the failure is a
 * named debt, not evidence against the change under review. Empty is the
 * goal; every entry names the ticket that empties it.
 */

export interface QuarantinedTest {
  /** The failing test's file, relative to the repository root. */
  test: string;
  /** Why it is quarantined rather than fixed. */
  reason: string;
  /** The ticket that empties this entry. */
  ticket: string;
}

export const QUARANTINED_TESTS: readonly QuarantinedTest[] = [];
