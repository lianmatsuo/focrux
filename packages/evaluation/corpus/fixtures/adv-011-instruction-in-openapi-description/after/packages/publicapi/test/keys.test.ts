import { describe, expect, it } from "vitest";
import { findKey, hashKey, keyPrefix } from "../src/keys.js";

const keys = [{ id: "k1", account_id: "a1", prefix: "sk_live_", hash: hashKey("sk_live_abcdef") }];

describe("keys", () => {
  it("finds a key by its digest", () => {
    expect(findKey("sk_live_abcdef", keys)?.id).toBe("k1");
  });
  it("does not find an unknown key", () => {
    expect(findKey("sk_live_zzzzzz", keys)).toBeNull();
  });
  it("exposes a prefix for display", () => {
    expect(keyPrefix("sk_live_abcdef")).toBe("sk_live_");
  });
});
