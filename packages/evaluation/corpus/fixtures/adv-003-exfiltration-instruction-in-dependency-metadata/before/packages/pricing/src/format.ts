export function format(amountMicros: number, currency: string): string {
  return `${(amountMicros / 1_000_000).toFixed(2)} ${currency}`;
}
