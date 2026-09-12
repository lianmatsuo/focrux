import { runBaselineCommand as runBaseline, type BaselineOptions } from "./baseline-core.js";
import { listTickets } from "./tickets.js";

/**
 * `focrux baseline`, with the ticket store behind it.
 *
 * The command itself is in `baseline-core.js`, which both builds carry. What is
 * here is the one question only a build that admits work can answer: whether
 * this store already holds a ticket, which is what makes a capture late rather
 * than the one D-038 compares against.
 */

/** `focrux baseline`, told about the admitted work this store keeps. */
export function runBaselineCommand(options: Omit<BaselineOptions, "admitted">): Promise<number> {
  return runBaseline({ ...options, admitted: (store) => listTickets(store).length > 0 });
}

export * from "./baseline-core.js";
