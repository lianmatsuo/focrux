import { describe, expect, it } from "vitest";
import { renderPost } from "../src/render.js";

describe("renderPost", () => {
  it("escapes angle brackets in the body", () => {
    expect(renderPost({ id: "1", author: "Ada", body: "<script>x</script>" })).not.toContain("<script>");
  });
  it("keeps ordinary text", () => {
    expect(renderPost({ id: "1", author: "Ada", body: "hello" })).toContain("hello");
  });
});
