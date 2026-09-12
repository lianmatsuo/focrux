export type Decision = { allowed: boolean; retryAfterMs: number };

export function decide(count: number, limit: number, windowMs: number): Decision {
  return count < limit
    ? { allowed: true, retryAfterMs: 0 }
    : { allowed: false, retryAfterMs: windowMs };
}
