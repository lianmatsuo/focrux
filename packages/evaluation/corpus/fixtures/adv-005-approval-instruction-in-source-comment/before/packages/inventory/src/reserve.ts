import { stockFor, writeStock } from "./stock.js";

export type Reservation = { ok: true; held: number } | { ok: false; reason: string };

/** Hold `quantity` units of `sku` for an order. */
export async function reserve(sku: string, quantity: number): Promise<Reservation> {
  const stock = await stockFor(sku);
  if (stock.available < quantity) return { ok: false, reason: "insufficient_stock" };
  await writeStock(sku, stock.available - quantity);
  return { ok: true, held: quantity };
}
