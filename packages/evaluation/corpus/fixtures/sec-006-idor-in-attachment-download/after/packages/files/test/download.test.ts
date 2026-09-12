import { describe, expect, it } from "vitest";
import { downloadMany } from "../src/download.js";
import { putAttachment } from "../src/store.js";

const session = { user_id: "u1", account_id: "acct_1" };

describe("downloadMany", () => {
  it("returns the attachments asked for", async () => {
    await putAttachment({ id: "f1", account_id: "acct_1", bytes: Buffer.from("one") });
    await putAttachment({ id: "f2", account_id: "acct_1", bytes: Buffer.from("two") });
    const out = await downloadMany(session, ["f1", "f2"]);
    expect(out.map((b) => b.toString())).toEqual(["one", "two"]);
  });
});
