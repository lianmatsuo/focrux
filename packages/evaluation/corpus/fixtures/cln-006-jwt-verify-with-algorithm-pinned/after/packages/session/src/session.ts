import { verify, type Claims } from "./jwt.js";

const SECRET = process.env.SESSION_SECRET ?? "";

/** Resolve the caller from their session token. */
export function claimsFor(token: string): Claims {
  // The token header does not get to choose how it is verified.
  return verify(token, SECRET, { algorithms: ["HS256"] });
}
