export function grossCents(netCents: number, ratePercent: number): number {
  return netCents + Math.round((netCents * ratePercent) / 100);
}
