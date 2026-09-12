import { describe, expect, it } from "vitest";
import { Sessions } from "../src/tokens.js";

const at = (ms: number) => () => ms;

describe("expiry", () => {
  it("rejects a validly signed token past its expiry", () => {
    let clock = 1_000;
    const sessions = new Sessions("k1-secret", { ttlMs: 60_000, now: () => clock });
    const token = sessions.issue("u1");
    expect(sessions.verify(token)?.sub).toBe("u1");
    clock = 1_000 + 60_001;
    expect(sessions.verify(token)).toBeNull();
  });
});

describe("rotation", () => {
  it("keeps verifying the previous key's tokens and rejects unknown keys", () => {
    const sessions = new Sessions("k1-secret", { now: at(1_000) });
    const oldToken = sessions.issue("u1");
    sessions.rotate("k2-secret");
    expect(sessions.verify(oldToken)?.sub).toBe("u1");

    const stranger = new Sessions("never-shared", { now: at(1_000) });
    expect(sessions.verify(stranger.issue("u1"))).toBeNull();
  });

  it("drops the previous key at the next rotation", () => {
    const sessions = new Sessions("k1-secret", { now: at(1_000) });
    const oldToken = sessions.issue("u1");
    sessions.rotate("k2-secret");
    sessions.rotate("k3-secret");
    expect(sessions.verify(oldToken)).toBeNull();
  });

  it("closes the previous-key window one ttl after rotation", () => {
    let clock = 1_000;
    const sessions = new Sessions("k1-secret", { ttlMs: 60_000, now: () => clock });
    sessions.rotate("k2-secret");
    // The old key can still mint fresh-exp tokens; time, not luck, must retire it.
    const minted = new Sessions("k1-secret", { ttlMs: 60_000, now: () => clock });
    clock = 1_000 + 59_999;
    expect(sessions.verify(minted.issue("u1"))?.sub).toBe("u1");
    clock = 1_000 + 60_000;
    expect(sessions.verify(minted.issue("u1"))).toBeNull();
  });
});

describe("configuration", () => {
  it("refuses to construct or rotate with an empty secret", () => {
    expect(() => new Sessions("")).toThrow(/refusing/);
    const sessions = new Sessions("k1-secret");
    expect(() => sessions.rotate(" ")).toThrow(/refusing/);
  });
});

describe("signatures", () => {
  it("rejects a tampered body", () => {
    const sessions = new Sessions("k1-secret", { now: at(1_000) });
    const [body, signature] = sessions.issue("u1").split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", exp: 10_000_000 })).toString("base64url");
    expect(sessions.verify(`${forged}.${signature}`)).toBeNull();
    expect(sessions.verify(`${body}.AAAA`)).toBeNull();
  });

  it("accepts exactly one token string per token: no extra segments, no alternate encodings", () => {
    const sessions = new Sessions("k1-secret", { now: at(1_000) });
    const token = sessions.issue("u1");
    expect(sessions.verify(token)?.sub).toBe("u1");
    expect(sessions.verify(`${token}.garbage`)).toBeNull();
    const [body, signature] = token.split(".");
    expect(sessions.verify(`${body}.${signature}=`)).toBeNull();
    expect(sessions.verify(`${body}.${signature}~`)).toBeNull();
  });

  it("returns null, never throws, on garbage input", () => {
    const sessions = new Sessions("k1-secret", { now: at(1_000) });
    for (const garbage of ["", ".", "..", "!!!.@@@", " . ", "a".repeat(10_000)]) {
      expect(sessions.verify(garbage)).toBeNull();
    }
  });
});
