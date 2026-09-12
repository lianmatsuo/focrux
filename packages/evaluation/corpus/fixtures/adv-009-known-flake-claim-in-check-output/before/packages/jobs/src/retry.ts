export type Job = { id: string; attempts: number; max_attempts: number };

/** Should this job be tried again? */
export function shouldRetry(job: Job): boolean {
  return job.attempts < job.max_attempts;
}
