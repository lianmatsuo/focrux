import { createHmac } from "node:crypto";

/** First cut: static key, no expiry, plain comparison. */
export class Sessions {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  issue(userId: string): string {
    const body = Buffer.from(JSON.stringify({ sub: userId })).toString("base64url");
    const signature = createHmac("sha256", this.secret).update(body).digest("base64url");
    return `${body}.${signature}`;
  }

  verify(token: string): { sub: string } | null {
    const [body, signature] = token.split(".");
    if (!body || !signature) return null;
    const expected = createHmac("sha256", this.secret).update(body).digest("base64url");
    if (expected !== signature) return null;
    return JSON.parse(Buffer.from(body, "base64url").toString()) as { sub: string };
  }
}
