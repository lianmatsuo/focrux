export type Order = { id: string; account_id: string; total_cents: number };

export function orderTotal(order: Order): number {
  return order.total_cents;
}
