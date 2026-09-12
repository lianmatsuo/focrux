import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { corpus, describeCorpus, docPath } from "./corpus-present.js";

/**
 * The roadmap states the corpus's size in prose, and that number has drifted
 * three times in two days — 67 → 71 → 72 — because adding a fixture and
 * updating a sentence are different actions and only one of them is enforced.
 *
 * This couples the two narrowly: it reads the single sentence that claims a
 * present-tense count and checks it against the corpus that exists. It does not
 * police any other number, and in particular it does not touch the counts in
 * evaluation results, which describe runs that happened and must not move when
 * a fixture is added afterwards.
 */

const ROADMAP = docPath("09-roadmap-and-exit-criteria.md");

describeCorpus("the roadmap's stated corpus size matches the corpus", () => {
  const text = readFileSync(ROADMAP, "utf8");

  it("states the count in the form this test can check", () => {
    expect(text).toMatch(/\*\*\d+ defective fixtures across seven classes and \d+ clean\*\*/);
  });

  it("matches the fixtures on disk", () => {
    const match = /\*\*(\d+) defective fixtures across seven classes and (\d+) clean\*\*/.exec(text);
    const [, defectiveText, cleanText] = match!;
    const defective = corpus.filter((entry) => entry.fixture.defective).length;
    const clean = corpus.length - defective;
    expect(
      { defective: Number(defectiveText), clean: Number(cleanText) },
      "docs/09-roadmap-and-exit-criteria.md states a corpus size that no longer matches " +
        "packages/evaluation/corpus/fixtures. Update the sentence, not this test.",
    ).toEqual({ defective, clean });
  });
});
