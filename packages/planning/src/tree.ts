import { execFileSync } from "node:child_process";
import { PlanningError } from "./errors.js";

const DEFAULT_LIMIT = 400;

/**
 * The tracked tree, two directory levels deep plus the files at the root.
 *
 * This is what the drafter is shown so that a proposed scope glob names a
 * directory that exists. Two levels is where a monorepo's packages live and is
 * small enough to sit in one prompt; the executor and the reviewer see the
 * full tree, the drafter does not need to.
 *
 * `git ls-files` by argv: the root is an argument, never part of a command line.
 */
export function repositoryTree(
  repositoryRoot: string,
  options: { limit?: number } = {},
): string[] {
  let listing: string;
  try {
    listing = execFileSync("git", ["-C", repositoryRoot, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new PlanningError(
      `cannot list the tracked files in ${repositoryRoot}: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
      { cause: error },
    );
  }

  const entries = new Set<string>();
  for (const path of listing.split("\0")) {
    if (path.length === 0) continue;
    const segments = path.split("/");
    if (segments.length === 1) {
      entries.add(path);
      continue;
    }
    entries.add(`${segments[0]}/`);
    if (segments.length > 2) entries.add(`${segments[0]}/${segments[1]}/`);
  }
  return [...entries].sort().slice(0, options.limit ?? DEFAULT_LIMIT);
}
