/**
 * Host suspend and resume (SCP-079 criterion 9).
 *
 * A closed laptop is a disconnect, not a pause. The agent process, the model
 * connection and any local service the attempt started are all gone or stale on
 * resume, and an attempt that carries on as though nothing happened produces a
 * transcript with a hole in it and a change set nobody can account for.
 *
 * Detection is a timer that measures how late it is. A five-second interval that
 * fires four hundred seconds later did not run slowly; the machine was asleep.
 */

export const DEFAULT_SUSPEND_INTERVAL_MS = 5_000;
/** Lateness above this is a suspend rather than a busy scheduler. */
export const DEFAULT_SUSPEND_THRESHOLD_MS = 60_000;

export interface SuspendEvent {
  detected_at: string;
  gap_ms: number;
}

export class SuspendDetector {
  private readonly onSuspend: (event: SuspendEvent) => void;
  private readonly intervalMs: number;
  private readonly thresholdMs: number;
  private readonly clock: () => number;
  private last: number;
  private timer: NodeJS.Timeout | null = null;
  private detected: SuspendEvent | null = null;

  constructor(
    onSuspend: (event: SuspendEvent) => void,
    intervalMs = DEFAULT_SUSPEND_INTERVAL_MS,
    thresholdMs = DEFAULT_SUSPEND_THRESHOLD_MS,
    clock: () => number = Date.now,
  ) {
    this.onSuspend = onSuspend;
    this.intervalMs = intervalMs;
    this.thresholdMs = thresholdMs;
    this.clock = clock;
    // Read once here so `tick()` is meaningful even without `start()`, and once
    // again in `start()` — a detector armed long after construction should
    // measure from when it was armed, not from when it was built.
    this.last = clock();
  }

  /** Exposed so the behaviour can be tested without sleeping a machine. */
  tick(): SuspendEvent | null {
    const now = this.clock();
    const gap = now - this.last;
    this.last = now;
    if (gap < this.intervalMs + this.thresholdMs) return null;
    const event = { detected_at: new Date(now).toISOString(), gap_ms: gap };
    if (!this.detected) {
      this.detected = event;
      this.onSuspend(event);
    }
    return event;
  }

  start(): void {
    if (this.timer) return;
    this.last = this.clock();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): SuspendEvent | null {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.detected;
  }
}
