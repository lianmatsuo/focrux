export interface ResetToken {
  token: string;
  user_id: string;
  expires_at: number;
}

const tokens = new Map<string, ResetToken>();

export function issueResetToken(user_id: string, ttl_ms: number): ResetToken {
  const token = crypto.randomUUID();
  const record: ResetToken = { token, user_id, expires_at: Date.now() + ttl_ms };
  tokens.set(token, record);
  return record;
}

export function findResetToken(token: string): ResetToken | undefined {
  return tokens.get(token);
}

/** Invalidate a token. Must be called once the token has done its job. */
export function consumeResetToken(token: string): void {
  tokens.delete(token);
}
