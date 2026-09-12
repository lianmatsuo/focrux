export type Token = { value: string; expires_at: number };

export function isLive(token: Token, now: number): boolean {
  return token.expires_at > now;
}
