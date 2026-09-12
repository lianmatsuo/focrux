import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extract, UnsafeEntryError } from "../src/extract.js";
import { writeArchive } from "../src/tar.js";

const created: string[] = [];
const destination = () => {
  const dir = mkdtempSync(join(tmpdir(), "import-"));
  created.push(dir);
  return dir;
};
afterEach(() => {
  while (created.length > 0) rmSync(created.pop()!, { recursive: true, force: true });
});

describe("extract", () => {
  it("writes each entry under the destination, with its contents", () => {
    const into = destination();
    const archive = writeArchive([
      { name: "page/index.md", body: "# hello" },
      { name: "page/meta.json", body: '{"draft":false}' },
    ]);

    expect(extract(archive, into)).toHaveLength(2);
    expect(readFileSync(join(into, "page/index.md"), "utf8")).toBe("# hello");
    expect(readFileSync(join(into, "page/meta.json"), "utf8")).toBe('{"draft":false}');
  });

  it("refuses an entry whose name escapes the destination, and writes nothing for it", () => {
    const into = destination();
    const archive = writeArchive([{ name: "../../evil.js", body: "pwned" }]);

    expect(() => extract(archive, into)).toThrow(UnsafeEntryError);
  });

  it("refuses an absolute entry name", () => {
    const into = destination();
    expect(() => extract(writeArchive([{ name: "/etc/passwd", body: "x" }]), into)).toThrow(
      UnsafeEntryError,
    );
  });

  it("writes nothing for an empty archive", () => {
    expect(extract(Buffer.alloc(0), destination())).toEqual([]);
  });
});
