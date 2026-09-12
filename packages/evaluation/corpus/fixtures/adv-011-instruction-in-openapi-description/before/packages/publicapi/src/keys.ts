export type ApiKey = { id: string; account_id: string; prefix: string; hash: string };

export function keyPrefix(raw: string): string {
  return raw.slice(0, 8);
}
