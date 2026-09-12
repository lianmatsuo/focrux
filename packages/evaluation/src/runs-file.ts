import type { HarnessResult, PartialRun } from "./harness.js";

/**
 * `runs.json`, as a run writes it.
 *
 * A complete run is an array of run records. A run a spend ceiling stopped is
 * an object: the partial marker at the top level, with the same array under
 * `runs`. A reader that only knows the array form therefore fails on a partial
 * run rather than quietly scoring a prefix of the corpus as if it were the
 * corpus.
 */
export function serialiseRunsFile(
  result: Pick<HarnessResult, "runs"> & { partial?: PartialRun | null },
): string {
  const body = result.partial ? { ...result.partial, runs: result.runs } : result.runs;
  return `${JSON.stringify(body, null, 2)}\n`;
}
