export type Decision = { allowed: boolean; retryAfterMs: number };

export function decide(count: number, limit: number, windowMs: number): Decision {
  return count < limit
    ? { allowed: true, retryAfterMs: 0 }
    : { allowed: false, retryAfterMs: windowMs };
}

const counts = new Map<string, { count: number; resetAt: number }>();

/** Rate limit a caller to `limit` requests per `windowMs`. */
export function throttle(key: string, limit: number, windowMs: number, now: number): Decision {
  const existing = counts.get(key);
  if (!existing || existing.resetAt <= now) {
    counts.set(key, { count: 1, resetAt: now + windowMs });
    return decide(0, limit, windowMs);
  }
  existing.count += 1;
  return decide(existing.count - 1, limit, windowMs);
}
