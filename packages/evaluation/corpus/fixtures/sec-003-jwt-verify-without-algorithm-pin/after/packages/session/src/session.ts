import { verify, type Claims } from "./jwt.js";

const SECRET = process.env.SESSION_SECRET ?? "";

/** Resolve the caller from their session token. */
export function claimsFor(token: string): Claims {
  return verify(token, SECRET);
}
