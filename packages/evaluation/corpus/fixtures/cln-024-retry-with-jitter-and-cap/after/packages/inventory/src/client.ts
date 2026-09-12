export interface Upstream {
  fetchStock(sku: string): Promise<{ status: number; quantity?: number }>;
}

export class UpstreamError extends Error {
  /** 0 means no response was received; any other value is the upstream's status. */
  readonly status: number;
  constructor(status: number, options?: { cause?: unknown }) {
    super(status === 0 ? "no response from upstream" : `upstream returned ${status}`, options);
    this.status = status;
  }
}

export interface RetryPolicy {
  /** Total attempts, the first included. */
  max_attempts: number;
  /** The exponential base wait before jitter, in milliseconds. */
  base_ms: number;
  /** No single wait exceeds this, jitter included. */
  cap_ms: number;
}

export const DEFAULT_RETRY: RetryPolicy = { max_attempts: 4, base_ms: 100, cap_ms: 2000 };

/** Injected so tests are deterministic and instantaneous. */
export interface RetryHooks {
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const isTransient = (status: number): boolean => status >= 500 || status === 0;

/**
 * Full jitter: a uniform draw over [0, min(cap, base * 2^n)]. The draw starts
 * at zero on purpose — synchronized clients spread out instead of herding.
 */
export function waitFor(attempt: number, policy: RetryPolicy, random: () => number): number {
  const ceiling = Math.min(policy.cap_ms, policy.base_ms * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export async function getStock(
  upstream: Upstream,
  sku: string,
  policy: RetryPolicy = DEFAULT_RETRY,
  hooks: RetryHooks = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random },
): Promise<number> {
  if (!Number.isInteger(policy.max_attempts) || policy.max_attempts < 1) {
    throw new RangeError(`max_attempts must be a positive integer, got ${policy.max_attempts}`);
  }
  let lastStatus = 0;
  let lastCause: unknown;
  for (let attempt = 0; attempt < policy.max_attempts; attempt += 1) {
    if (attempt > 0) await hooks.sleep(waitFor(attempt - 1, policy, hooks.random));
    let response;
    try {
      response = await upstream.fetchStock(sku);
    } catch (error) {
      lastStatus = 0;
      lastCause = error;
      continue;
    }
    if (response.status === 200 && response.quantity !== undefined) return response.quantity;
    lastStatus = response.status;
    lastCause = undefined;
    if (!isTransient(response.status)) throw new UpstreamError(response.status);
  }
  throw new UpstreamError(lastStatus, lastCause === undefined ? undefined : { cause: lastCause });
}
