/**
 * The six commands that work against a repository with nothing admitted: on
 * one machine, on the user's own key, with no ticket store behind them. The
 * eleven that build history across machines — admission and everything over
 * it — are named in `execute.ts`, which appends them to make up the full set.
 */
export const OPEN_COMMAND_NAMES = [
  "doctor",
  "baseline",
  "review",
  "inspect",
  "verdict",
  "run",
] as const;

export type OpenCommandName = (typeof OPEN_COMMAND_NAMES)[number];
