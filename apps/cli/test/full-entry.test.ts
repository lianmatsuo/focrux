import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCli, removeStagedBundles, spawnBuilt } from "./open-build.js";

/**
 * The CLI's command table, run as a program and asked rather than read off the
 * source: the six that work against a repository with nothing admitted, and the
 * eleven that build history across machines.
 */

/** The six commands that work against a repository with nothing admitted, named here rather than imported from the code under test. */
const OPEN = ["doctor", "baseline", "review", "inspect", "verdict", "run"] as const;

/** The eleven that build history across machines, likewise. */
const CLOSED = [
  "admit",
  "approve",
  "edit",
  "list",
  "sync",
  "serve",
  "mcp",
  "agent",
  "stops",
  "escapes",
  "principle",
] as const;

let dist: string;
// A full `tsc` compile of `apps/cli`, timed against a machine that is also
// running a loop attempt and a second gate rather than an idle one (SCP-191);
// 180s is the margin already measured for that build elsewhere in this suite.
beforeAll(() => {
  dist = buildCli();
}, 180_000);

afterAll(removeStagedBundles);

function invoke(entry: "main.js", args: string[]) {
  const result = spawnBuilt([join(dist, entry), ...args], {
    // Nothing here reaches the store, but a command that tried would find the
    // package's own directory rather than a repository with records in it.
    cwd: dist,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Every command a help text offers, in the order it offers them.
 *
 * `focrux <name>` is how the help names a command, and the lookbehind keeps a
 * path — `<repo>/.focrux back`, `.focrux/state` — from reading as one.
 */
function offered(help: string): string[] {
  const names: string[] = [];
  for (const match of help.matchAll(/(?<![\w.])focrux\s+([a-z][a-z-]*)/g)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

// Both tests below spawn against the one `dist` the `beforeAll` above
// compiled, so they are pinned to run one after another rather than left to
// whatever vitest's default would do to a describe block that shares it.
describe.sequential("the entry point", () => {
  // Seventeen cold spawns of the built binary in one test, each individually
  // bounded by `spawnBuilt`'s own deadline; 60s covers all seventeen running
  // slow under the loaded-machine load SCP-191 measures without covering a
  // genuine hang, which `spawnBuilt` fails on well before this fires.
  it("carries all seventeen commands", () => {
    for (const command of [...OPEN, ...CLOSED]) {
      const help = invoke("main.js", [command, "--help"]);
      expect(help.code, `${command} --help`).toBe(0);
      expect(help.stderr).not.toMatch(/unknown command/);
    }
  }, 60_000);

  it("offers the eleven in its help", () => {
    const help = invoke("main.js", ["--help"]);
    expect(help.code).toBe(0);
    expect(offered(help.stderr)).toEqual(expect.arrayContaining([...CLOSED]));
  }, 60_000);
});
