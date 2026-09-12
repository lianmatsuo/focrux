import { describe, expect, it } from "vitest";
import * as contracts from "@focrux/contracts";
import { AuthoredAttemptSchema, MAX_REPORTED_ATTEMPTS, issueAuthoredAttempts } from "../src/index.js";

/**
 * `issueAuthoredAttempts` and its schema moved to `@focrux/contracts` (SCP-179)
 * because the ticketless review needs them and belongs beside that reading.
 * This package re-exports them at the path they had, so the drafting side
 * reads unchanged; the names are the same objects, not copies.
 */
describe("the authored-attempt reader this package re-exports", () => {
  it("is the one @focrux/contracts holds, and it still reads a body", () => {
    expect(issueAuthoredAttempts).toBe(contracts.issueAuthoredAttempts);
    expect(AuthoredAttemptSchema).toBe(contracts.AuthoredAttemptSchema);
    expect(MAX_REPORTED_ATTEMPTS).toBe(contracts.MAX_REPORTED_ATTEMPTS);
    expect(issueAuthoredAttempts("this is already done").attempts).toHaveLength(1);
  });
});
