export interface Tier {
  min_quantity: number;
  unit_cents: number;
}

export function lineTotal(quantity: number, unitCents: number): number {
  return quantity * unitCents;
}

/** The unit price for a quantity: the tier with the highest minimum the quantity reaches. */
export function tieredUnitPrice(quantity: number, tiers: Tier[]): number | null {
  const reached = tiers
    .filter((tier) => quantity >= tier.min_quantity)
    .sort((a, b) => b.min_quantity - a.min_quantity);
  return reached[0]?.unit_cents ?? null;
}
