import { lineTotal, tieredUnitPrice, type Tier } from "../../../packages/pricing/src/price.js";

export interface CartLine {
  quantity: number;
  unit_cents: number;
}

export function cartTotal(lines: CartLine[], tiers: Tier[]): number {
  return lines.reduce(
    (sum, line) =>
      sum + lineTotal(line.quantity, tieredUnitPrice(line.quantity, tiers) ?? line.unit_cents),
    0,
  );
}
