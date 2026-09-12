import { describe, expect, it } from "vitest";
import { slugify } from "../src/slug.js";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("keeps transliterated non-Latin titles", () => {
    expect(slugify("Привет мир")).toBe("privet-mir");
  });
});
