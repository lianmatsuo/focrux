export type Sku = { id: number; code: string; name: string };

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Codes are compared case-insensitively, so they are stored normalised. */
export function isDuplicateCode(existing: string[], code: string): boolean {
  return existing.map(normaliseCode).includes(normaliseCode(code));
}
