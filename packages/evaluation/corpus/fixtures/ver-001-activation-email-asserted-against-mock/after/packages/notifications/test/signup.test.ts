import { describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn(async () => {});
vi.mock("../src/send.js", () => ({ sendEmail }));

const { signup } = await import("../src/signup.js");

describe("signup", () => {
  it("creates one user", async () => {
    const { id } = await signup("new@example.com", "correct-horse");
    expect(id).toMatch(/^user_/);
  });

  it("sends exactly one activation email", async () => {
    sendEmail.mockClear();
    await signup("other@example.com", "correct-horse");
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
