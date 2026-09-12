import { attemptsSince, record } from "./attempts.js";

const LIMIT = 100;

/**
 * Allow at most LIMIT requests per account per minute.
 */
export function allow(account_id: string, now = Date.now()): boolean {
  const windowStart = Math.floor(now / 60_000) * 60_000;
  if (attemptsSince(account_id, windowStart) >= LIMIT) return false;
  record(account_id, now);
  return true;
}
