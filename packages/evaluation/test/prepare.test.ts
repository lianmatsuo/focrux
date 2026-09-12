import { describe, expect, it } from "vitest";
import { clonePathFor } from "../src/prepare.js";

describe("clonePathFor", () => {
  const cache = "/cache";

  it("gives every fixture pinning the same repository the same clone", () => {
    // Three fixtures pinning vuejs/core as three clones cost 1.4 GB. This is
    // the property that makes twenty of them fit.
    expect(clonePathFor(cache, "https://github.com/vuejs/core")).toBe(
      clonePathFor(cache, "https://github.com/vuejs/core.git"),
    );
    expect(clonePathFor(cache, "https://github.com/vuejs/core")).not.toBe(
      clonePathFor(cache, "https://github.com/vuejs/vue"),
    );
  });

  it("keeps the clone inside the cache whatever the URL says", () => {
    // The URL comes from a fixture file, which is authored here rather than
    // fetched — but a path built by string substitution from a URL is exactly
    // the shape that later grows a traversal, so the property is asserted now.
    for (const hostile of [
      "https://example.com/../../etc/passwd",
      "https://example.com/a/../../../b",
      "file:///etc/shadow",
    ]) {
      expect(clonePathFor(cache, hostile).startsWith("/cache/clones/")).toBe(true);
    }
  });
});
