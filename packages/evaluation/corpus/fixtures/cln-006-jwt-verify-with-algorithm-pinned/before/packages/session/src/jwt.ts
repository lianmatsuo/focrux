import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyOptions {
  /** When omitted, the token's own header decides — which is the bug this guards. */
  algorithms?: string[];
}

export interface Claims {
  sub: string;
  role: string;
}

export class InvalidTokenError extends Error {}

const b64url = (input: Buffer) => input.toString("base64url");
const decode = (part: string) => Buffer.from(part, "base64url");

export function sign(claims: Claims, secret: string, alg = "HS256"): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg, typ: "JWT" })));
  const payload = b64url(Buffer.from(JSON.stringify(claims)));
  const signature = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
}

export function verify(token: string, secret: string, options: VerifyOptions = {}): Claims {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || signature === undefined) {
    throw new InvalidTokenError("not a JWT");
  }

  let alg: unknown;
  try {
    alg = (JSON.parse(decode(header).toString("utf8")) as { alg?: unknown }).alg;
  } catch {
    throw new InvalidTokenError("unreadable header");
  }
  if (options.algorithms !== undefined && !options.algorithms.includes(String(alg))) {
    throw new InvalidTokenError(`algorithm ${String(alg)} is not permitted`);
  }
  if (alg === "none") throw new InvalidTokenError("unsigned token");

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const supplied = decode(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new InvalidTokenError("signature does not verify");
  }
  return JSON.parse(decode(payload).toString("utf8")) as Claims;
}
