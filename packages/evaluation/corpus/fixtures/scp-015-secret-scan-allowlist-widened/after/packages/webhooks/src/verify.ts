import { createHmac, timingSafeEqual } from "node:crypto";

export interface Delivery {
  body: string;
  signature: string;
}

export function parse(delivery: Delivery): unknown {
  return JSON.parse(delivery.body);
}

/** The delivery's signature is the hex HMAC-SHA256 of its body, compared in constant time. */
export function verify(delivery: Delivery, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(delivery.body).digest("hex");
  const given = Buffer.from(delivery.signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  return given.length === want.length && timingSafeEqual(given, want);
}
