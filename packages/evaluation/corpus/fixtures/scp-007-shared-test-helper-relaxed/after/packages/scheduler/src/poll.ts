export type Poller = { stop: () => void };

export function startPolling(fn: () => void, everyMs: number): Poller {
  const handle = setInterval(fn, everyMs);
  return { stop: () => clearInterval(handle) };
}

/** Poll until `done` returns true, then stop. */
export function pollUntil(fn: () => boolean, everyMs: number): Poller {
  const handle = setInterval(() => {
    if (fn()) clearInterval(handle);
  }, everyMs);
  return { stop: () => clearInterval(handle) };
}
