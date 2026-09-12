import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "vitest";
import { CORPUS_DIR_ENV, defaultCorpusDir, loadCorpus, type LoadedFixture } from "../src/corpus.js";

/**
 * The gate the suites whose subject is the corpus stand behind.
 *
 * The harness can be run in a checkout without the fixture corpus. A suite
 * whose *subject* is the corpus — the corpus is well formed — has nothing to
 * assert there, and absence is a fact about that tree rather than a defect in
 * it. So those suites skip, naming what is missing, and never fail on absence.
 * Suites that exercise the harness's own mechanics do not use this: they take
 * their fixtures from `sample/`, which travels with the harness.
 *
 * The environment override exists for one reason: `corpus-absence.test.ts` runs
 * these suites against a directory that is not there and proves they skip. A
 * property nobody can observe failing is not a property.
 */

/** Re-exported: the loader owns the name, since a bare read now honours it too. */
export { CORPUS_DIR_ENV };

/** The override when it is set, else the packaged corpus — the loader's own rule. */
export const corpusDir = defaultCorpusDir();
export const corpusPresent = existsSync(corpusDir);

/** This repository's `docs/`, three levels above the package. */
export const docsDir = resolve(import.meta.dirname, "..", "..", "..", "docs");

/** A path under `docs/`, so a suite states which document it needs rather than reaching for one. */
export function docPath(...segments: string[]): string {
  return join(docsDir, ...segments);
}

export const CORPUS_ABSENT_REASON =
  "the seeded-defect corpus is not in this tree, and this suite's subject is the corpus itself";

const WHERE_THE_FIXTURES_ARE =
  "The fixtures published with the harness are in sample/fixtures; SCORING.md says what they are for.";

if (!corpusPresent) {
  console.warn(`${CORPUS_ABSENT_REASON}: ${corpusDir} does not exist. ${WHERE_THE_FIXTURES_ARE}`);
}

/** The corpus, or nothing when it is absent — every reader of this is behind `describeCorpus`. */
export const corpus: LoadedFixture[] = corpusPresent ? loadCorpus(corpusDir) : [];

/**
 * The loader called with no directory at all: the one such call in this
 * package's tests, and the reason it is in this file.
 *
 * `corpus-read-guard.test.ts` refuses that call in every suite, because a read
 * whose directory nobody states is a read the gate above cannot see. Its own
 * behaviour still has to be proved, so `corpus-default-dir.test.ts` calls this
 * — the real loader, with the override moved — rather than restating what the
 * loader does. Nothing else should call it: a suite that wants the corpus wants
 * `corpus`, behind `describeCorpus`.
 */
export function loadCorpusFromDefaultDir(): LoadedFixture[] {
  return loadCorpus();
}

/**
 * `describe`, replaced by one skipped test saying why, when what it asserts on
 * is not in this tree.
 *
 * The factory is not run at all in that case, on purpose: a suite that reads
 * the corpus while *collecting* — a `git ls-files` over the fixtures, a
 * document read beside a `const` — would throw before a skip could apply, and
 * the point here is that absence never produces an error.
 */
export function describeWhen(
  present: boolean,
  reason: string,
): (name: string, factory: () => void) => void {
  return (name, factory) => {
    if (present) {
      describe(name, factory);
      return;
    }
    describe(name, () => {
      it.skip(`skipped: ${reason}`, () => undefined);
    });
  };
}

/** `describe`, skipped and saying why, when the corpus is not in this tree. */
export const describeCorpus = describeWhen(corpusPresent, CORPUS_ABSENT_REASON);

/**
 * Every suite in this package whose subject is the corpus, and which therefore
 * skips where the corpus is not. `corpus-absence.test.ts` runs exactly this
 * list, so a suite added to the gate and left off here is a suite nothing
 * proves the skip for.
 */
export const CORPUS_SUBJECT_SUITES = [
  "test/corpus.test.ts",
  "test/credential-sweep.test.ts",
  "test/expectation-reachability.test.ts",
  "test/forbidden-strings.test.ts",
  "test/legibility-sweep.test.ts",
  "test/pinned.test.ts",
  "test/redaction-row.test.ts",
  "test/roadmap-counts.test.ts",
  "test/scope-escape-class.test.ts",
  "test/secret-row.test.ts",
  "test/suite.test.ts",
] as const;
