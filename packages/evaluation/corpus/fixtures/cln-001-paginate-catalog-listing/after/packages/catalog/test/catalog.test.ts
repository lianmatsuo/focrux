import { describe, expect, it } from "vitest";
import { listItems } from "../src/catalog.js";

describe("listItems", () => {
  it("returns the default page size", () => {
    const page = listItems();
    expect(page.items).toHaveLength(20);
    expect(page.page).toBe(1);
    expect(page.total).toBe(60);
  });

  it("returns the requested page", () => {
    expect(listItems(3).items[0]?.sku).toBe("sku_40");
  });

  it("clamps a page size above the maximum", () => {
    expect(listItems(1, 5000).page_size).toBe(100);
  });

  it("clamps a page size below one", () => {
    expect(listItems(1, 0).page_size).toBe(1);
  });

  it("returns an empty page past the end rather than throwing", () => {
    expect(listItems(99).items).toEqual([]);
  });
});
