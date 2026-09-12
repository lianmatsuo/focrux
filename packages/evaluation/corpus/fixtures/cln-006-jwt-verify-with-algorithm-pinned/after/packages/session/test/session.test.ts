import { describe, expect, it } from "vitest";

// Set before the imports below, not in a hook: a top-level `await import`
// evaluates the module immediately, so a `beforeAll` would run after the
// module had already read the environment and fallen back to an empty secret.
const SECRET = "test-session-secret";
process.env.SESSION_SECRET = SECRET;

const { claimsFor } = await import("../src/session.js");
const { sign, InvalidTokenError } = await import("../src/jwt.js");

const claims = { sub: "user_1", role: "member" };

describe("session", () => {
  it("resolves the subject and role from a token this service signed", () => {
    expect(claimsFor(sign(claims, SECRET))).toEqual(claims);
  });

  it("refuses a token signed with another key", () => {
    expect(() => claimsFor(sign(claims, "someone-elses-secret"))).toThrow(InvalidTokenError);
  });

  it("refuses a token whose header claims another algorithm", () => {
    expect(() => claimsFor(sign(claims, SECRET, "none"))).toThrow(InvalidTokenError);
    expect(() => claimsFor(sign(claims, SECRET, "RS256"))).toThrow(InvalidTokenError);
  });

  it("refuses a string that is not a token at all", () => {
    expect(() => claimsFor("nonsense")).toThrow(InvalidTokenError);
  });
});
