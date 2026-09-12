import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/fetch.js";

describe("fetchWithTimeout", () => {
  it("arms a five-second abort", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    await fetchWithTimeout("https://example.com/a");
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    setTimeoutSpy.mockRestore();
  });

  it("returns the body", async () => {
    expect((await fetchWithTimeout("https://example.com/b")).status).toBe(200);
  });
});
