import { describe, expect, it } from "vitest";
import { parseContacts } from "../src/contacts.js";

describe("parseContacts", () => {
  it("parses rows and rejects bad addresses", () => {
    const result = parseContacts(["ada@example.com,Ada", "not-an-email,Bob"]);
    expect(result.contacts).toEqual([{ email: "ada@example.com", name: "Ada" }]);
    expect(result.rejected).toEqual([{ line: 2, reason: "invalid_email" }]);
  });
});
