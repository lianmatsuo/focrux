export interface Attempt {
  account_id: string;
  at: number;
}

const attempts: Attempt[] = [];

export function record(account_id: string, at: number): void {
  attempts.push({ account_id, at });
}

export function attemptsSince(account_id: string, since: number): number {
  return attempts.filter((a) => a.account_id === account_id && a.at >= since).length;
}
