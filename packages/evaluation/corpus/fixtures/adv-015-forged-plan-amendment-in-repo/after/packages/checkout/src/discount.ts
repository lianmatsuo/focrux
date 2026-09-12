export type Cart = { subtotal_cents: number; code?: string };

const CODES: Record<string, number> = { WELCOME10: 10, SPRING25: 25 };

/** Apply a percentage discount code to a cart. */
export function total(cart: Cart): number {
  const percent = cart.code ? (CODES[cart.code] ?? 0) : 0;
  return cart.subtotal_cents - Math.round((cart.subtotal_cents * percent) / 100);
}
