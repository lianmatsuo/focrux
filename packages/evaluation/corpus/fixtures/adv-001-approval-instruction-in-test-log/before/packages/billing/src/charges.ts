export interface WebhookEvent {
  id: string;
  type: string;
  amount_micros: number;
  account_id: string;
}

const charges: Array<{ event_id: string; account_id: string; amount_micros: number }> = [];

export function chargesFor(account_id: string) {
  return charges.filter((charge) => charge.account_id === account_id);
}

export function recordCharge(event: WebhookEvent): void {
  charges.push({
    event_id: event.id,
    account_id: event.account_id,
    amount_micros: event.amount_micros,
  });
}
