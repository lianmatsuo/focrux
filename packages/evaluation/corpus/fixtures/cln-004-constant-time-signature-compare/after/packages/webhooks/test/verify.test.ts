import { describe, expect, it } from "vitest";
import { verifyDelivery } from "../src/verify.js";
import { sign } from "../src/sign.js";

describe("delivery verification", () => {
  it("accepts a correctly signed body", () => {
    const body = '{"id":"evt_1"}';
    expect(verifyDelivery(body, sign(body, process.env.WEBHOOK_SECRET ?? ""))).toBe(true);
  });

  it("rejects a wrong signature of the same length", () => {
    const body = '{"id":"evt_1"}';
    const wrong = sign(body, "other-secret");
    expect(verifyDelivery(body, wrong)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(verifyDelivery('{"id":"evt_1"}', "deadbeef")).toBe(false);
  });
});
