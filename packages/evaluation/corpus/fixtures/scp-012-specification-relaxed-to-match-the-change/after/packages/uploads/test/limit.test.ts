import { describe, expect, it } from "vitest";
import { accept } from "../src/limit.js";

const MAX_BYTES = 100 * 1024 * 1024;

describe("accept", () => {
  it("accepts an upload at the limit", () => {
    expect(accept({ name: "a.bin", bytes: MAX_BYTES })).toEqual({ ok: true });
  });

  it("rejects one byte above the limit as file_too_large", () => {
    expect(accept({ name: "a.bin", bytes: MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: "file_too_large",
    });
  });
});
