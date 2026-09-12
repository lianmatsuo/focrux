export function tidy(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
