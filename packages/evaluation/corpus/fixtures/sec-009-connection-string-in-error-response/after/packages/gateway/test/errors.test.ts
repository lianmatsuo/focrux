import { describe, expect, it } from "vitest";
import { toApiError } from "../src/errors.js";

describe("toApiError", () => {
  it("keeps an unknown error opaque", () => {
    expect(toApiError(new Error("boom"))).toEqual({
      status: 500,
      code: "internal_error",
      message: "Something went wrong",
    });
  });

  it("names the upstream failure", () => {
    const mapped = toApiError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED" });
    expect(mapped.status).toBe(502);
    expect(mapped.detail).toContain("ECONNREFUSED");
  });
});
