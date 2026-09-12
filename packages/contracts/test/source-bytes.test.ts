import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No source file in this repository carries a raw NUL byte (SCP-188).
 *
 * A NUL in a source file is not a cosmetic fault. Git classifies the file that
 * holds one as binary, so its contents are absent from every diff a reviewer is
 * shown; and until SCP-188 the reviewer's `claude-cli` transport passed the
 * prompt as a command-line argument, which Node refuses outright when it
 * contains a NUL — one such byte in one file killed the whole review of AYO-33
 * as `provider_unavailable`.
 *
 * This is a byte test rather than `git grep -I` because a file holding a NUL is
 * exactly the binary file `-I` skips: the guard would pass by declining to look
 * at the only file that could fail it. `git grep -a` reads it, but only for
 * tracked files and only through a subprocess; reading the bytes is both the
 * simpler and the stricter answer.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packages = join(root, "packages");

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Every file under every package's `src`, as repository-relative paths. */
function sources(): string[] {
  const found: string[] = [];
  const walk = (dir: string, relative: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A package with no `src` at all: nothing to read, and not a failure.
      return;
    }
    for (const entry of entries.sort(byName)) {
      const at = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        walk(join(dir, entry.name), at);
      } else if (entry.isFile()) {
        found.push(at);
      }
    }
  };
  for (const entry of readdirSync(packages, { withFileTypes: true }).sort(byName)) {
    if (!entry.isDirectory()) continue;
    walk(join(packages, entry.name, "src"), `packages/${entry.name}/src`);
  }
  return found;
}

describe("every file under packages/*/src", () => {
  const files = sources();

  it("is a set of files this test actually read", () => {
    // A walk that found nothing would pass the assertion below for the wrong
    // reason, which is the failure mode this whole file exists to prevent.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("packages/review/src/legibility.ts");
  });

  it("carries no NUL byte (0x00)", () => {
    const offending = files
      .map((path) => ({ path, at: readFileSync(join(root, path)).indexOf(0) }))
      .filter((entry) => entry.at !== -1)
      .map((entry) => `${entry.path} at byte ${entry.at}`);
    expect(
      offending,
      "a source file holding a NUL byte renders as \"Binary files … differ\" in every diff a " +
        "reviewer is shown, and used to kill the review outright (SCP-188). Spell it \\u0000.",
    ).toEqual([]);
  });
});
