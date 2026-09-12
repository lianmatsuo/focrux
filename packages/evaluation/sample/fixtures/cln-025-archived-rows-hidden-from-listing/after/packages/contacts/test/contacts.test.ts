import { beforeEach, describe, expect, it } from "vitest";
import { archive, create, list, reset, restore } from "../src/contacts.js";

describe("archiving", () => {
  beforeEach(reset);

  it("removes an archived contact from the default listing", () => {
    const kept = create("Ada", "ada@example.test");
    const gone = create("Ben", "ben@example.test");
    expect(list()).toHaveLength(2);
    expect(archive(gone.id)).toBe(true);
    expect(list().map((contact) => contact.id)).toEqual([kept.id]);
  });

  it("surfaces archived contacts behind the explicit flag, beside the active ones", () => {
    const active = create("Ada", "ada@example.test");
    const archived = create("Ben", "ben@example.test");
    archive(archived.id, new Date("2026-09-01T00:00:00Z"));
    const everyone = list({ includeArchived: true });
    expect(everyone.map((contact) => contact.id).sort()).toEqual([active.id, archived.id].sort());
    expect(everyone.find((contact) => contact.id === archived.id)?.archived_at).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(everyone.find((contact) => contact.id === active.id)?.archived_at).toBeNull();
  });

  it("returns copies: mutating a listed contact does not bypass restore()", () => {
    const contact = create("Ada", "ada@example.test");
    archive(contact.id);
    const listed = list({ includeArchived: true })[0]!;
    listed.archived_at = null;
    expect(list()).toHaveLength(0);
  });

  it("restores a contact with its fields intact", () => {
    const contact = create("Ada", "ada@example.test");
    archive(contact.id);
    expect(restore(contact.id)).toBe(true);
    const [restored] = list();
    expect(restored).toMatchObject({ name: "Ada", email: "ada@example.test", archived_at: null });
  });

  it("refuses to archive twice or restore the unarchived", () => {
    const contact = create("Ada", "ada@example.test");
    expect(restore(contact.id)).toBe(false);
    expect(archive(contact.id)).toBe(true);
    expect(archive(contact.id)).toBe(false);
  });
});
