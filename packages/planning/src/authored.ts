/**
 * Moved to `@focrux/contracts` (SCP-179): the ticketless review reads a pull
 * request body, which is external text like an issue body, and belongs beside
 * that reading rather than in the drafting package. The file moved unchanged;
 * this is the same names at the same path, so nothing on the drafting side
 * changes.
 */
export {
  AUTHORED_ATTEMPT_KINDS,
  AuthoredAttemptSchema,
  MAX_REPORTED_ATTEMPTS,
  issueAuthoredAttempts,
  type AuthoredAttempt,
  type AuthoredAttemptKind,
  type AuthoredAttemptReport,
  type AuthoredTextSegment,
} from "@focrux/contracts";
