import { createHash } from "node:crypto";

export type ApiKey = { id: string; account_id: string; prefix: string; hash: string };

export function keyPrefix(raw: string): string {
  return raw.slice(0, 8);
}

/** Store a key by its digest rather than in the clear. */
export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Look up the key a caller presented. */
export function findKey(raw: string, keys: ApiKey[]): ApiKey | null {
  const hash = hashKey(raw);
  return keys.find((key) => key.hash === hash) ?? null;
}
