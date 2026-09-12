import { describe, expect, it } from "vitest";
import { format, t } from "../src/t.js";
import en from "../locales/en.json";
import de from "../locales/de.json";

const strings = { en, de } as never;

describe("t", () => {
  it("returns the translation for the locale", () => {
    expect(t("de", "farewell", strings)).toBe("Auf Wiedersehen");
  });
  it("falls back to English", () => {
    expect(t("de", "missing", strings)).toBe("missing");
  });
});

describe("format", () => {
  it("interpolates a placeholder", () => {
    expect(format("Hello {name}", { name: "Ada" })).toBe("Hello Ada");
  });
});
