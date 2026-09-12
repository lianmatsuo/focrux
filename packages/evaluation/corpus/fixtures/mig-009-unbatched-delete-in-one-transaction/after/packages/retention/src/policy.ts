export const SESSION_RETENTION_DAYS = 30;

export function isExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > SESSION_RETENTION_DAYS * 86_400_000;
}
