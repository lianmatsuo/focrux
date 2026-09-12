import { describe, expect, it } from "vitest";
import { health } from "../src/health.js";

const client = { ping: async () => "pong" as const, version: async () => "2.1.0" };

describe("health", () => {
  it("reports ok and the upstream version", async () => {
    expect(await health(client)).toEqual({ ok: true, version: "2.1.0" });
  });
});
