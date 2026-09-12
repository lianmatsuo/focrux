import { describe, expect, it } from "vitest";
import { listInvoices } from "../src/list.js";

describe("listInvoices", () => {
  it("returns rows for an account", async () => {
    expect(await listInvoices("acct_1")).toEqual([]);
  });

  it("accepts a sort", async () => {
    expect(await listInvoices("acct_1", { column: "amount_cents", direction: "ASC" })).toEqual([]);
  });
});
