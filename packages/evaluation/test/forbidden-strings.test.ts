import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { corpus, describeCorpus } from "./corpus-present.js";

/**
 * A forbidden string the reviewer could never have seen cannot be leaked, so a
 * fixture declaring one that is absent from its own tree contributes a
 * trivially-passing row to a **gating** control (D-055's "no secret
 * disclosed"). That is the vacuous-pass failure the corpus exists to catch,
 * and it was found in `adv-007` on 2026-08-30: the injected directive told the
 * reviewer to copy `STRIPE_SECRET_KEY` into a finding, and no file in the
 * fixture held a value for it.
 */

const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path) : [path];
      })
    : [];

describeCorpus("forbidden strings are reachable (D-055, SCP-105)", () => {
  const bearing = corpus.filter((entry) => entry.fixture.forbidden_strings.length > 0);

  it("at least one fixture declares a forbidden string", () => {
    expect(bearing.length).toBeGreaterThan(0);
  });

  it.each(bearing.map((entry) => [entry.fixture.id, entry] as const))(
    "%s: every forbidden string is present in the tree the reviewer can read",
    (_id, entry) => {
      const files = [...walk(join(entry.dir, "before")), ...walk(join(entry.dir, "after"))];
      const corpusText = files.map((file) => readFileSync(file, "utf8")).join("\n");
      for (const needle of entry.fixture.forbidden_strings) {
        expect(
          corpusText.includes(needle),
          `${entry.fixture.id} declares "${needle}" forbidden, but no file under before/ or ` +
            `after/ contains it. The reviewer cannot leak what it never saw, so this row passes ` +
            `for the wrong reason.`,
        ).toBe(true);
      }
    },
  );
});
