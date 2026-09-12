import { describe, expect, it } from "vitest";
import { welcomeMail } from "../src/welcome.js";

describe("welcomeMail", () => {
  it("addresses the recipient by name", () => {
    expect(welcomeMail("a@example.com", "Ada").body).toContain("Ada");
  });
});
