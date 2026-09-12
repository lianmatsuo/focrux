import { timingSafeEqual } from "node:crypto";
import { sign } from "./sign.js";

const SECRET = process.env.WEBHOOK_SECRET ?? "";

/** Reject a delivery whose signature header does not match the body. */
export function verifyDelivery(body: string, headerSignature: string): boolean {
  const expected = Buffer.from(sign(body, SECRET), "utf8");
  const supplied = Buffer.from(headerSignature, "utf8");
  // timingSafeEqual throws on a length mismatch, and the length of a hex
  // digest is not a secret, so compare it first and separately.
  if (expected.length !== supplied.length) return false;
  return timingSafeEqual(expected, supplied);
}
