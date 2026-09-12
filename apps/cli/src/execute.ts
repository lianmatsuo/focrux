import { TicketSchema, transition } from "@focrux/contracts";
import { UsageError } from "./args.js";
import type { TicketRunResult } from "@focrux/runner";
import {
  applyObservedPath,
  loadAdmitted,
  readTicket,
  statesObserved,
  writeTicket,
} from "./admit.js";
import {
  mergeRunConfig,
  reopen,
  runsStartedBy,
  runDoctorCommand as runDoctorReport,
  runExecuteCommand as runExecute,
  type AdmittedWork,
  type DoctorOptions,
  type ExecuteOptions,
  type TicketRuns,
} from "./execute-core.js";
import { listTickets } from "./tickets.js";
import { mergedTicketContext } from "./relevel.js";
import { derivedBranch, recordDelivery } from "./sync.js";
import { OPEN_COMMAND_NAMES } from "./command-names.js";

/**
 * `focrux run` and `focrux doctor`, with the ticket store behind them.
 *
 * The commands themselves are in `execute-core.ts`. What is here is everything
 * that only means something where work is admitted: the run configuration a
 * ticket derives, the states a run moves it through, and the ticket key a
 * ceiling hit is reported under.
 */

/** Every command the full build carries, in the order its help lists them. */
export const FULL_COMMAND_SET = [
  ...OPEN_COMMAND_NAMES,
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

export type FullCommandName = (typeof FULL_COMMAND_SET)[number];

/** A ticket key per ticket id, for the ceiling hits `doctor` reports. */
const ticketKeys = (store: string): Map<string, string> =>
  new Map(listTickets(store).map((ticket) => [ticket.ticket_id, ticket.key]));

/**
 * The ticket store as a run uses it. Each method is the step `execute-core.ts`
 * used to take inline, and the ticket it reads is re-read from the store at
 * each one: the file on disk is what the next command will read, so it is what
 * this must act on.
 */
export const TICKET_RUNS: TicketRuns = {
  load(input) {
    const admitted = loadAdmitted(input.cwd, input.repo, input.store, input.key);
    return { dir: admitted.dir, key: admitted.ticket.key, contract: admitted.contract };
  },

  runConfig(work: AdmittedWork, override: unknown, publish: boolean) {
    const ticket = readTicket(work.dir, work.key);
    return mergeRunConfig(
      {
        dir: work.dir,
        key: ticket.key,
        repository_root: ticket.repository_root,
        source: ticket.source ?? null,
        branch: ticket.delivery.branch,
        publish,
      },
      override,
    );
  },

  async relevelContext(work: AdmittedWork, base_ref: string) {
    const ticket = readTicket(work.dir, work.key);
    return mergedTicketContext({
      dir: work.dir,
      repository_root: ticket.repository_root,
      base_ref,
      branch: ticket.delivery.branch ?? derivedBranch(work.dir, work.key, ticket),
      except: ticket.key,
    });
  },

  starting(work: AdmittedWork, relevel: boolean) {
    if (relevel) {
      // SCP-227: a re-level is not a new attempt at the ticket. The branch is
      // at `pr_open` and stays there, and the run moves nothing. The loop
      // counts the runs on the attempts record itself (null here), so a
      // re-level's attempt ids are minted after every recorded run's rather
      // than colliding with the last one's root.
      const open = readTicket(work.dir, work.key);
      if (open.state !== "pr_open") {
        throw new UsageError(
          `${work.key} is ${open.state}; --relevel merges the base into an open pull request's ` +
            "branch, and only a ticket at pr_open has one",
        );
      }
      // Only the loop's own pull request: a direct arm's or a person's hand-off
      // is not the loop's to re-level, and recording a re-level on it would
      // read as the loop's work in the measurement.
      if (open.delivery.arm !== "loop" || open.delivery.opened_by === "hand_off") {
        throw new UsageError(
          `${work.key}'s pull request is ${open.delivery.opened_by === "hand_off" ? "a person's hand-off" : `the ${open.delivery.arm} arm's`}; ` +
            "--relevel is for the loop's own",
        );
      }
      return null;
    }
    // A ticket that already ran comes back through `ready`, because that is
    // what the lifecycle calls a new attempt.
    //
    // Every state that is not `ready` is rescued, not the two that were easy to
    // name. A ticket interrupted mid-run — the process killed during
    // provisioning, or left `executing` by a defect — had no row to
    // `provisioning` and threw `IllegalTransitionError` at the user as
    // "the review did not complete" with a stack trace, permanently, with no
    // command able to recover it. A ticket is re-runnable or it is a dead
    // record; there is no third thing.
    let ticket = readTicket(work.dir, work.key);
    if (ticket.state !== "ready") {
      ticket = reopen(ticket, `new attempt after ${ticket.state}`);
    }
    // Recorded before the attempt, not after: a run that never returns has to
    // leave the ticket saying so rather than saying `ready`.
    const started = transition(
      ticket,
      "provisioning",
      `run started against ${work.contract.plan_id}`,
    );
    writeTicket(work.dir, started);
    // The ticket own count of the runs it has begun, this one included. The
    // runner mints the root attempt id from it, so a re-run of the same
    // immutable contract appends a distinct attempt chain rather than colliding
    // with the last one.
    return runsStartedBy(started);
  },

  finished(work: AdmittedWork, result: TicketRunResult, at: Date, relevel: boolean) {
    if (relevel) {
      // SCP-227: the ticket stays at `pr_open` whatever the re-level did — a
      // branch that is level, one that is not yet, and one a person now has
      // to reconcile are all still an open pull request. The delivery record
      // is the same pull request's and keeps who opened it and which arm; only
      // the checks the run read are written over it. `sync` reads the rest.
      const open = readTicket(work.dir, work.key);
      const read = result.delivery_checks;
      const kept =
        read === null
          ? open
          : TicketSchema.parse({
              ...open,
              delivery: { ...open.delivery, checks: [...read.checks], checks_state: read.state, observed_at: at.toISOString() },
            });
      if (kept !== open) writeTicket(work.dir, kept);
      return kept.state;
    }
    const moved = applyObservedPath(
      recordDelivery(readTicket(work.dir, work.key), result, at),
      statesObserved(result),
      at,
    );
    writeTicket(work.dir, moved);
    return moved.state;
  },
};

/** `focrux run`, with `--ticket` reading the store this build keeps. */
export function runExecuteCommand(options: Omit<ExecuteOptions, "tickets">): Promise<number> {
  return runExecute({ ...options, tickets: TICKET_RUNS });
}

/** `focrux doctor`, reporting the full command set and naming tickets by key. */
export function runDoctorCommand(
  options: Omit<DoctorOptions, "commands" | "keyFor"> & { commands?: readonly string[] },
): Promise<number> {
  return runDoctorReport({
    ...options,
    commands: options.commands ?? FULL_COMMAND_SET,
    keyFor: ticketKeys,
  });
}

export * from "./execute-core.js";
