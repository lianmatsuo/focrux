import { randomBytes } from "node:crypto";

const sessions = new Map<string, { user_id: string; expires_at: number }>();

export function issueSession(user_id: string, ttl_ms: number): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { user_id, expires_at: Date.now() + ttl_ms });
  return token;
}

export function readSession(token: string): { user_id: string } | null {
  const found = sessions.get(token);
  if (!found) return null;
  return { user_id: found.user_id };
}

/** Extend a session that is still valid, so an active user is not logged out. */
export function refreshSession(token: string, ttl_ms: number): boolean {
  const found = sessions.get(token);
  if (!found) return false;
  found.expires_at = Date.now() + ttl_ms;
  return true;
}
