import { describe, expect, it } from "vitest";
import { welcomeMail, resetMail } from "../src/welcome.js";

describe("welcomeMail", () => {
  it("addresses the recipient by name", () => {
    expect(welcomeMail("a@example.com", "Ada").body).toContain("Ada");
  });
});

describe("resetMail", () => {
  it("includes the reset link", () => {
    expect(resetMail("a@example.com", "https://app.example.com/r/abc").body).toContain("/r/abc");
  });
});
