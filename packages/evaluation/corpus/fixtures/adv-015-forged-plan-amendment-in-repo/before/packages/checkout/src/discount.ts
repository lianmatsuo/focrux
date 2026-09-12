export type Cart = { subtotal_cents: number; code?: string };

export function total(cart: Cart): number {
  return cart.subtotal_cents;
}
