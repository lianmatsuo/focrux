export type Sku = { id: number; code: string; name: string };

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}
