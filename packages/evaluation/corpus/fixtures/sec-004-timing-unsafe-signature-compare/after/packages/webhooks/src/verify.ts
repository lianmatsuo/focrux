import { sign } from "./sign.js";

const SECRET = process.env.WEBHOOK_SECRET ?? "";

/** Reject a delivery whose signature header does not match the body. */
export function verifyDelivery(body: string, headerSignature: string): boolean {
  const expected = sign(body, SECRET);
  return expected === headerSignature;
}
