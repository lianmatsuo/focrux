import { createHmac, timingSafeEqual } from "node:crypto";

export interface Claims {
  sub: string;
  /** Unix milliseconds. Non-optional: a token without an expiry is not issued. */
  exp: number;
}

const sign = (secret: string, body: string): Buffer =>
  createHmac("sha256", secret).update(body).digest();

/** Canonical base64url only: a segment that does not round-trip is a distinct
 * string for the same bytes, and accepting it would let infinitely many token
 * strings name one session — defeating revocation lists and audit keyed on the
 * token string. */
const decodeCanonical = (segment: string): Buffer | null => {
  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
};

export class Sessions {
  private current: string;
  private previous: string | null = null;
  private rotatedAt = 0;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(secret: string, options: { ttlMs?: number; now?: () => number } = {}) {
    if (!secret || secret.trim().length === 0) {
      throw new Error("sessions: a signing secret is required; refusing an empty one");
    }
    this.current = secret;
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /**
   * The old key keeps verifying for one ttl after rotation — every token it
   * legitimately signed has expired by then — or until the next rotation,
   * whichever comes first. Time-bounding the window means a single rotate()
   * fully retires a compromised key once the ttl passes.
   */
  rotate(next: string): void {
    if (!next || next.trim().length === 0) {
      throw new Error("sessions: a signing secret is required; refusing an empty one");
    }
    this.previous = this.current;
    this.rotatedAt = this.now();
    this.current = next;
  }

  issue(userId: string): string {
    const claims: Claims = { sub: userId, exp: this.now() + this.ttlMs };
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${body}.${sign(this.current, body).toString("base64url")}`;
  }

  verify(token: string): Claims | null {
    const segments = token.split(".");
    if (segments.length !== 2) return null;
    const [body, encoded] = segments;
    if (!body || !encoded || decodeCanonical(body) === null) return null;
    const signature = decodeCanonical(encoded);
    if (signature === null) return null;
    const keys = [this.current];
    if (this.previous !== null && this.now() < this.rotatedAt + this.ttlMs) {
      keys.push(this.previous);
    }
    const matches = keys.some((key) => {
      const expected = sign(key, body);
      return expected.length === signature.length && timingSafeEqual(expected, signature);
    });
    if (!matches) return null;
    let claims: Claims;
    try {
      claims = JSON.parse(Buffer.from(body, "base64url").toString()) as Claims;
    } catch {
      // Reachable only for a key-holder-signed non-JSON body (a co-signer on a
      // shared secret); still a verification failure, not a crash.
      return null;
    }
    if (typeof claims.exp !== "number" || claims.exp <= this.now()) return null;
    return claims;
  }
}
