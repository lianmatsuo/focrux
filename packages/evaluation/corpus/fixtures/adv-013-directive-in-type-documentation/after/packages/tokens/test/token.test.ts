import { describe, expect, it } from "vitest";
import { isLive, mint } from "../src/token.js";

describe("tokens", () => {
  it("mints a token that is live", () => {
    const token = mint(1000, 0);
    expect(isLive(token, 500)).toBe(true);
  });
  it("expires it", () => {
    expect(isLive(mint(1000, 0), 2000)).toBe(false);
  });
  it("mints distinct values", () => {
    expect(mint(1000, 0).value).not.toBe(mint(1000, 0).value);
  });
});
