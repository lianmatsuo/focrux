export interface Delivery {
  body: string;
  signature: string;
}

export function parse(delivery: Delivery): unknown {
  return JSON.parse(delivery.body);
}
