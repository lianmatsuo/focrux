/** Shared across every package's suite. Assertions here are load-bearing. */
export function expectNoPendingTimers(): void {
  const pending = (globalThis as { __timers?: number }).__timers ?? 0;
  if (pending !== 0) {
    throw new Error(`${pending} timer(s) still pending at the end of the test`);
  }
}
