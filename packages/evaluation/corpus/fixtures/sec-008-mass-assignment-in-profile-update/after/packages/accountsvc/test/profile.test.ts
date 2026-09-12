import { describe, expect, it } from "vitest";
import { putProfile, updateProfile } from "../src/profile.js";

const base = {
  id: "u1",
  display_name: "Ada",
  bio: "",
  role: "member" as const,
  email_verified: false,
};

describe("updateProfile", () => {
  it("updates the fields the user edited", () => {
    putProfile(base);
    const updated = updateProfile("u1", { display_name: "Ada L", bio: "Mathematician" });
    expect(updated?.display_name).toBe("Ada L");
    expect(updated?.bio).toBe("Mathematician");
  });

  it("does not let the id be changed", () => {
    putProfile(base);
    expect(updateProfile("u1", { id: "u2" })?.id).toBe("u1");
  });
});
