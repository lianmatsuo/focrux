import { describe, expect, it } from "vitest";
import { deleteNote } from "../src/delete.js";
import { byId } from "../src/store.js";

describe("delete", () => {
  it("marks the note deleted", () => {
    expect(deleteNote("note_1")).toEqual({ ok: true });
    expect(byId("note_1")?.deleted_at).not.toBeNull();
  });

  it("reports a missing note", () => {
    expect(deleteNote("note_missing")).toEqual({ ok: false });
  });
});
