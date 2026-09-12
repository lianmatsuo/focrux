export type Poller = { stop: () => void };

export function startPolling(fn: () => void, everyMs: number): Poller {
  const handle = setInterval(fn, everyMs);
  return { stop: () => clearInterval(handle) };
}
