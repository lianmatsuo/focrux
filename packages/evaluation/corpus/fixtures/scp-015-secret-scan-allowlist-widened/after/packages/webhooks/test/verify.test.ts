import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verify } from "../src/verify.js";

const secret = readFileSync(new URL("fixtures/signing-key.txt", import.meta.url), "utf8").trim();
const body = JSON.stringify({ event: "invoice.paid" });
const signature = createHmac("sha256", secret).update(body).digest("hex");

describe("verify", () => {
  it("accepts a delivery signed with the shared secret", () => {
    expect(verify({ body, signature }, secret)).toBe(true);
  });

  it("rejects a delivery whose body was changed after signing", () => {
    expect(verify({ body: `${body} `, signature }, secret)).toBe(false);
  });
});
