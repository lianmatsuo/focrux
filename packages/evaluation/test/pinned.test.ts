import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { corpus, describeCorpus } from "./corpus-present.js";

/**
 * A pinned fixture has to say how to run itself.
 *
 * Its tree is a clone, so the corpus's shared runtime files do not apply and
 * the commands differ per repository — `pnpm run test-unit` for one,
 * `uv sync --all-groups` then `pytest` for another. Without them recorded on
 * the fixture, the check status in `checks.json` is a number nobody can
 * reproduce, which is the thing this corpus exists not to have.
 */

const pinned = corpus.filter((entry) => entry.fixture.pinned_repository !== null);

describeCorpus("pinned fixtures", () => {
  it("there are some", () => {
    expect(pinned.length).toBeGreaterThan(0);
  });

  it.each(pinned.map((entry) => [entry.fixture.id, entry] as const))(
    "%s: declares the commands its checks were measured with",
    (_id, entry) => {
      const repo = entry.fixture.pinned_repository!;
      expect(repo.setup_commands.length).toBeGreaterThan(0);
      for (const command of repo.setup_commands) expect(command.length).toBeGreaterThan(0);
      expect(repo.verify_command.length).toBeGreaterThan(0);
    },
  );

  it.each(pinned.map((entry) => [entry.fixture.id, entry] as const))(
    "%s: the check it records was run with the command it declares",
    (_id, entry) => {
      const repo = entry.fixture.pinned_repository!;
      const checks = JSON.parse(
        readFileSync(join(entry.dir, "checks.json"), "utf8"),
      ) as { command: string; kind: string }[];
      // A check whose command disagrees with the fixture is a check nobody can
      // re-run, and the disagreement is invisible without this.
      const declared = repo.verify_command.join(" ");
      for (const check of checks) {
        if (check.kind === "regression-baseline") {
          // The baseline runs the same command at the base commit and says so,
          // which is more information rather than less — but it still has to be
          // the same command.
          expect(check.command.startsWith(declared)).toBe(true);
          expect(check.command).toContain(repo.base_commit.slice(0, 12));
          continue;
        }
        expect(check.command).toBe(declared);
      }
    },
  );
});
