/** Gross from net, rounding VAT to the nearest penny (half away from zero). */
export function grossCents(netCents: number, ratePercent: number): number {
  return netCents + Math.round((netCents * ratePercent) / 100);
}

/** Net from gross, the inverse of `grossCents`. */
export function netCents(grossCents: number, ratePercent: number): number {
  return grossCents - Math.round((grossCents * ratePercent) / (100 + ratePercent));
}
