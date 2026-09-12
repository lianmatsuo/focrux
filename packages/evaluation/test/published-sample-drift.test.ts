import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { corpusDir, describeCorpus } from "./corpus-present.js";
import { SAMPLE_IDS, sampleDir } from "./sample-fixtures.js";

/**
 * The sample is a copy, and a copy drifts. Nothing else checks it: the fixture
 * validators read the corpus directory and would not notice a sample fixture
 * edited to make a test pass — which is the exact move the corpus rules exist
 * to prevent, moved one directory sideways.
 */

/** Every file under `dir`, as repository-relative path -> sha256. */
function digests(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.set(relative(dir, path), createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

describeCorpus("the published sample is a copy, not a variant", () => {
  it("matches the corpus fixture of the same id, file for file", () => {
    for (const id of SAMPLE_IDS) {
      expect(
        [...digests(join(sampleDir, id))].sort(),
        `${id} in sample/ differs from the corpus fixture it was copied from. ` +
          "Copy it again; never edit the copy.",
      ).toEqual([...digests(join(corpusDir, id))].sort());
    }
  });
});
