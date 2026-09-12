import { describe, expect, it } from "vitest";
import { inviteAll } from "../src/invite.js";

describe("inviteAll", () => {
  it("invites everyone on the list", async () => {
    const sent: string[] = [];
    const results = await inviteAll(
      [{ email: "a@x.com", team_id: "t1" }, { email: "b@x.com", team_id: "t1" }],
      async (i) => { sent.push(i.email); },
    );
    expect(sent).toEqual(["a@x.com", "b@x.com"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
