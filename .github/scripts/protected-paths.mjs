#!/usr/bin/env node
// Fails a pull request that changes a file this project's own CI treats as
// judging a change, rather than as something a change produces: the tests
// that check the reviewer's blocking, remediation and decision-order logic,
// the runner's security test, and the sample fixtures the reviewer is scored
// on. A change under review must not
// also be the change that edits what the review is graded against.
//
// The reviewer's own prompt and code are not on that list. Changing the
// reviewer is the contribution this repository invites; its regression score
// is what holds it honest.
//
// Usage: node protected-paths.mjs <base-sha> <head-sha> [--repo <dir>] [--config <path>]
//
// <base-sha> and <head-sha> are the pull request's base and head commits, read
// by the workflow from the event payload and passed here as plain arguments --
// never a branch name, and never anything read out of the pull request's own
// title, body or diff.
//
// The changed-file list is `git diff --name-only <base>...<head>`, computed
// against the merge base rather than the base tip, so a base branch that moved
// on since the pull request opened does not itself trigger a false positive.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function parseArgs(argv) {
  const positional = [];
  let repo = process.cwd();
  let config = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--repo") {
      repo = argv[(i += 1)];
    } else if (arg === "--config") {
      config = argv[(i += 1)];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [base, head] = positional;
  if (!base || !head || positional.length > 2) {
    throw new Error(
      "Usage: protected-paths.mjs <base-sha> <head-sha> [--repo <dir>] [--config <path>]",
    );
  }
  if (!SHA_RE.test(base) || !SHA_RE.test(head)) {
    throw new Error(
      `<base-sha> and <head-sha> must be commit SHAs, got ${JSON.stringify(base)} and ${JSON.stringify(head)}`,
    );
  }
  const repoDir = resolve(repo);
  return {
    base,
    head,
    repo: repoDir,
    config: config ? resolve(config) : resolve(repoDir, ".github", "protected-paths.json"),
  };
}

/** `*` matches within one path segment, `**` across segments. Anchored to the whole path. */
export function matchesGlob(pattern, path) {
  const source = pattern
    .split("**")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\*", "[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`).test(path);
}

export function changedFiles(repo, base, head) {
  const out = execFileSync("git", ["-C", repo, "diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  });
  return out.split("\n").filter((line) => line.length > 0);
}

export function loadProtectedConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`no protected-paths config at ${configPath}`);
  }
  const parsed = JSON.parse(readFileSync(configPath, "utf8"));
  if (!Array.isArray(parsed.protected_tests) || !Array.isArray(parsed.protected_paths)) {
    throw new Error(`${configPath} must carry a "protected_tests" array and a "protected_paths" array`);
  }
  return { protected_tests: parsed.protected_tests, protected_paths: parsed.protected_paths };
}

/**
 * Every changed file that is protected, with the rule it matched.
 *
 * `protected_tests` is matched by exact equality, not by prefix: a file whose
 * name merely starts with a protected test's path (a `.bak` beside it, an
 * unrelated file one directory level deeper with a matching name) is not the
 * protected file and is not refused. `protected_paths` is matched by the same
 * anchored glob the assembler itself uses, so a path there protects
 * everything under it deliberately, the way a directory-scoped entry should.
 */
export function protectedHits(changedPaths, { protected_tests, protected_paths }) {
  const exact = new Set(protected_tests);
  const hits = [];
  for (const file of changedPaths) {
    if (exact.has(file)) {
      hits.push({ file, rule: `a protected test (${file})` });
      continue;
    }
    const matched = protected_paths.find((pattern) => matchesGlob(pattern, file));
    if (matched) hits.push({ file, rule: `a protected path (${matched})` });
  }
  return hits;
}

function main(argv) {
  const { base, head, repo, config } = parseArgs(argv);
  const protectedConfig = loadProtectedConfig(config);
  const changed = changedFiles(repo, base, head);
  const hits = protectedHits(changed, protectedConfig);

  if (hits.length === 0) {
    console.log(`protected-paths: ${changed.length} file(s) changed in this pull request, none protected.`);
    return 0;
  }

  console.error(`protected-paths: this pull request changes ${hits.length} protected file(s):\n`);
  for (const { file, rule } of hits) console.error(`  ${file} — matches ${rule}`);
  console.error(
    "\nThese files judge a change; a change under review cannot also be the change that edits " +
      "what judges it. A maintainer's release commit on the default branch is the one path that " +
      "may change them — see CONTRIBUTING.md.",
  );
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
