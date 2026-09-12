export type Delivery = { url: string; body: string; attempt: number };

const logged: string[] = [];
export function deliveryLog(): readonly string[] {
  return logged;
}

/** Deliver, retrying a 5xx up to twice. A 4xx is final. */
export async function deliver(delivery: Delivery, send: (d: Delivery) => Promise<number>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const status = await send({ ...delivery, attempt });
    logged.push(`attempt=${attempt} status=${status}`);
    if (status >= 200 && status < 300) return true;
    if (status < 500) return false;
  }
  return false;
}
