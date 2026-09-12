import { lineTotal } from "../../../packages/pricing/src/price.js";

export interface CartLine {
  quantity: number;
  unit_cents: number;
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line.quantity, line.unit_cents), 0);
}
