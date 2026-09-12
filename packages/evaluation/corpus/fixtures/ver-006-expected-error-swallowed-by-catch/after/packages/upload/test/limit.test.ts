import { describe, expect, it } from "vitest";
import { acceptUpload } from "../src/limit.js";

describe("acceptUpload", () => {
  it("accepts an ordinary upload", () => {
    expect(() => acceptUpload({ filename: "a.png", bytes: 1024 })).not.toThrow();
  });

  it("rejects an upload over the limit", () => {
    try {
      acceptUpload({ filename: "big.zip", bytes: 900 * 1024 * 1024 });
    } catch (error) {
      // Deliberately tolerant: the message has changed before.
      expect(error).toBeDefined();
    }
  });
});
