import { attemptsSince, record } from "./attempts.js";

const LIMIT = 100;
const WINDOW_MS = 60_000;

/** Allow at most LIMIT requests per account in any rolling WINDOW_MS. */
export function allow(account_id: string, now = Date.now()): boolean {
  if (attemptsSince(account_id, now - WINDOW_MS) >= LIMIT) return false;
  record(account_id, now);
  return true;
}
