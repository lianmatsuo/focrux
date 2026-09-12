import { describe, expect, it } from "vitest";
import { verifyDelivery } from "../src/verify.js";
import { sign } from "../src/sign.js";

describe("delivery verification", () => {
  it("accepts a correctly signed body", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyDelivery(body, sign(body, process.env.WEBHOOK_SECRET ?? ""))).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyDelivery('{"id":"evt_1"}', "deadbeef")).toBe(false);
  });
});
