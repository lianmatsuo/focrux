import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY, UpstreamError, getStock, waitFor } from "../src/client.js";

// 0.75 rather than 0.5, deliberately: at exactly 0.5 an exponent off-by-one is
// invisible, since 0.5 * base * 2^(n+1) equals base * 2^n.
const hooks = (waits: number[], random = () => 0.75) => ({
  sleep: async (ms: number) => {
    waits.push(ms);
  },
  random,
});

const failing = (statuses: number[], quantity = 7) => {
  let call = 0;
  return {
    calls: () => call,
    fetchStock: async () => {
      const status = statuses[call] ?? 200;
      call += 1;
      return status === 200 ? { status, quantity } : { status };
    },
  };
};

describe("getStock", () => {
  it("returns the success after transient failures", async () => {
    const upstream = failing([503, 503, 200]);
    const quantity = await getStock(upstream, "sku_1", DEFAULT_RETRY, hooks([]));
    expect(quantity).toBe(7);
    expect(upstream.calls()).toBe(3);
  });

  it("tries exactly max_attempts times when the upstream never recovers", async () => {
    const upstream = failing([503, 503, 503, 503, 503]);
    await expect(getStock(upstream, "sku_1", DEFAULT_RETRY, hooks([]))).rejects.toThrow(UpstreamError);
    expect(upstream.calls()).toBe(4);
  });

  it("does not retry a caller error", async () => {
    const upstream = failing([400]);
    await expect(getStock(upstream, "sku_1", DEFAULT_RETRY, hooks([]))).rejects.toThrow("400");
    expect(upstream.calls()).toBe(1);
  });

  it("retries a thrown network error as transient", async () => {
    let call = 0;
    const upstream = {
      fetchStock: async () => {
        call += 1;
        if (call < 2) throw new Error("ECONNRESET");
        return { status: 200, quantity: 3 };
      },
    };
    expect(await getStock(upstream, "sku_1", DEFAULT_RETRY, hooks([]))).toBe(3);
  });

  it("waits exactly within the stated bracket on every attempt", async () => {
    const waits: number[] = [];
    const upstream = failing([503, 503, 503, 503]);
    await expect(getStock(upstream, "sku_1", DEFAULT_RETRY, hooks(waits))).rejects.toThrow();
    // At random = 0.75 the exact expected waits are 75, 150, 300; an exponent
    // off-by-one would produce 150, 300, 600 and fail here.
    expect(waits).toEqual([75, 150, 300]);
  });

  it("actually jitters: the wait is the random draw scaled, zero included", () => {
    expect(waitFor(0, DEFAULT_RETRY, () => 0)).toBe(0);
    expect(waitFor(0, DEFAULT_RETRY, () => 0.999)).toBe(99);
    expect(waitFor(3, DEFAULT_RETRY, () => 0.25)).toBe(200);
  });

  it("never waits longer than the cap even at high attempt counts", () => {
    expect(waitFor(10, DEFAULT_RETRY, () => 1)).toBeLessThanOrEqual(2000);
  });

  it("keeps the root cause on the error after exhaustion", async () => {
    const boom = new Error("ECONNRESET");
    const upstream = { fetchStock: async () => { throw boom; } };
    const error = await getStock(upstream, "sku_1", DEFAULT_RETRY, hooks([])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe("no response from upstream");
    expect((error as Error).cause).toBe(boom);
  });

  it("refuses a nonsensical attempt budget instead of failing confusingly", async () => {
    await expect(
      getStock(failing([]), "sku_1", { ...DEFAULT_RETRY, max_attempts: 0 }, hooks([])),
    ).rejects.toThrow(RangeError);
  });
});
