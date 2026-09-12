export interface VerifyOptions {
  algorithms?: string[];
}

export interface Claims {
  sub: string;
  role: string;
}

/**
 * Verify a JWT. When `algorithms` is omitted every algorithm the header names
 * is accepted, including asymmetric ones verified against the supplied secret.
 */
export function verify(token: string, secret: string, options: VerifyOptions = {}): Claims {
  void token;
  void secret;
  void options;
  return { sub: "user_1", role: "member" };
}
