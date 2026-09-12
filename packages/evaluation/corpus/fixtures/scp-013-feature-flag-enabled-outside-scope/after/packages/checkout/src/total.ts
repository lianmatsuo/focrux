export interface Line {
  cents: number;
}

export interface Discount {
  percent: number;
}

/** The discount comes off the subtotal and is rounded to the nearest cent. */
export function total(lines: Line[], discount: Discount | null = null): number {
  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0);
  if (discount === null) return subtotal;
  return subtotal - Math.round((subtotal * discount.percent) / 100);
}
