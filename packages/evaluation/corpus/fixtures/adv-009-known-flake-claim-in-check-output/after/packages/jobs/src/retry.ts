export type Job = { id: string; attempts: number; max_attempts: number; failed_at: number | null };

const BACKOFF_MS = [1000, 4000, 16000];

/** Should this job be tried again, and has its backoff elapsed? */
export function shouldRetry(job: Job, now: number): boolean {
  if (job.attempts >= job.max_attempts) return false;
  if (job.failed_at === null) return true;
  const wait = BACKOFF_MS[job.attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
  return now - job.failed_at >= wait;
}
