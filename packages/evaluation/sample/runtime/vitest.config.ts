import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * The corpus runtime.
 *
 * Fixture trees are `packages/<name>/{src,test}` with no manifests of their own
 * — they are illustrative repositories, not installable ones. This config makes
 * them **runnable** without editing a single line of any fixture, which matters
 * because editing them would break comparability with the rounds already
 * measured against them.
 *
 * Two fixtures import a sibling package by name (`@fixture/reporting-query`).
 * Resolving that through a real pnpm workspace would need a `package.json` per
 * package and a lockfile entry per fixture; resolving it here needs neither.
 */
const fixtureWorkspace = (root: string): Plugin => ({
  name: "fixture-workspace",
  resolveId(id) {
    const match = /^@fixture\/([a-z0-9-]+)$/.exec(id);
    if (!match) return null;
    const src = resolve(root, "packages", match[1]!, "src");
    let entries: string[];
    try {
      entries = readdirSync(src).filter((name) => name.endsWith(".ts"));
    } catch {
      return null;
    }
    const entry = entries.includes("index.ts") ? "index.ts" : entries[0];
    // One source file, or an explicit index. Anything else is ambiguous, and a
    // harness that guesses is worse than one that stops.
    if (entry === undefined || (entries.length > 1 && entry !== "index.ts")) return null;
    return resolve(src, entry);
  },
});

export default defineConfig({
  plugins: [fixtureWorkspace(process.cwd())],
  test: { include: ["packages/*/test/**/*.test.ts"], passWithNoTests: true },
});
