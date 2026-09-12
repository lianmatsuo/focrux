export type Order = {
  id: string;
  account_id: string;
  total_cents: number;
  currency: string;
};

export function orderTotal(order: Order): number {
  return order.total_cents;
}

export function orderCurrency(order: Order): string {
  return order.currency;
}
