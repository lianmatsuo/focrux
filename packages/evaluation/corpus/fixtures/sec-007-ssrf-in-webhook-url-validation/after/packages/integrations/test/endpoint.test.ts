import { describe, expect, it } from "vitest";
import { isDeliverable } from "../src/endpoint.js";

describe("isDeliverable", () => {
  it("accepts an ordinary https endpoint", () => {
    expect(isDeliverable("https://hooks.example.com/x")).toBe(true);
  });

  it("refuses loopback", () => {
    expect(isDeliverable("https://localhost/x")).toBe(false);
    expect(isDeliverable("https://127.0.0.1/x")).toBe(false);
  });
});
