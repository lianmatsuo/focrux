import { describe, expect, it } from "vitest";
import { verifyAccount, verifiedAt } from "../src/verify.js";

describe("account verification", () => {
  it("records a verification time", async () => {
    await verifyAccount("user_1");
    expect(await verifiedAt("user_1")).not.toBeUndefined();
  });
});
