export type Delivery = { url: string; body: string; attempt: number };

export async function deliver(delivery: Delivery, send: (d: Delivery) => Promise<number>): Promise<boolean> {
  const status = await send(delivery);
  return status >= 200 && status < 300;
}
