import { describe, expect, it } from "vitest";
import { issueResetToken } from "../src/auth/tokens.js";
import { resetPassword } from "../src/auth/password-reset.js";
import { getPasswordHash } from "../src/auth/store.js";

describe("password reset", () => {
  it("sets the new password for a valid token", async () => {
    const { token } = issueResetToken("user_1", 60_000);
    expect(await resetPassword(token, "correct-horse")).toEqual({ ok: true });
    expect(await getPasswordHash("user_1")).toBe("hash:correct-horse");
  });

  it("rejects an expired token", async () => {
    const { token } = issueResetToken("user_2", -1);
    expect(await resetPassword(token, "anything")).toEqual({
      ok: false,
      reason: "expired_token",
    });
  });

  it("rejects an unknown token", async () => {
    expect(await resetPassword("not-a-token", "anything")).toEqual({
      ok: false,
      reason: "unknown_token",
    });
  });
});
