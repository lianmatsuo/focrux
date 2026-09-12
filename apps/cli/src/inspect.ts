import { existsSync } from "node:fs";
import { join } from "node:path";
import { QUEUE_HOLDING_STATES, pullRequestAttribution, queueOrder } from "@focrux/contracts";
import { runsStartedBy } from "./execute-core.js";
import {
  type QueueStanding,
  attemptsRecordSubject,
  buildInspectReport as buildReport,
  runInspectCommand as runInspect,
  type InspectOptions,
  type InspectReport,
  type InspectSubject,
  type ResolveSubject,
} from "./inspect-core.js";
import { UsageError } from "./args.js";
import type { Streams } from "./streams.js";
import { TicketStoreError, listTickets, readTicketForDisplay, type DisplayTicket } from "./tickets.js";
import { describeScheduling } from "./waits.js";

/**
 * `focrux inspect`, with the ticket store behind it.
 *
 * The command itself is in `inspect-core.js`, which both builds carry: the
 * attempts, the bundles and the review it joins them to are working state of
 * one machine. What is here is what only an admitted ticket can answer — the
 * key the record is filed under, the state the ticket is in, how it was
 * admitted and where the work came from — read from the ticket file and passed
 * in as the subject of the report.
 */

/** The ticket a key names, as the report needs it. */
const ticketFileSubject = (storeDirectory: string, key: string): InspectSubject => {
  const ticket = readTicketForDisplay(storeDirectory, key);
  // SCP-173: the delivery record when it already says — written the moment a
  // run opens a pull request, so it answers for a ticket still `failed` behind
  // an earlier round's pull request with no `pr_open` row in its history at
  // all. SCP-176: falling back to what the row that reached `pr_open`
  // recorded about itself, never off the shape of the transition, for a
  // legacy record with nothing decided. `from: "failed"` was once enough,
  // because a hand-off was the only thing that row could be; the loop's own
  // pull request outliving a failed re-run writes the same two states and is
  // not a hand-off, so the edge no longer answers the question. `null` when
  // neither source says — a legacy record `sync` walked without being able to
  // attribute it to either. That is a third answer, not a `false` that would
  // read as "the loop, definitely".
  const attribution = ticket.delivery.opened_by ?? pullRequestAttribution(ticket);
  return {
    kind: "ticket",
    ticket: ticket.key,
    ticket_id: ticket.ticket_id,
    // A ticket's contract is its own; what it is *for* is its title, which is
    // the field a local run's outcome stands in the same column as.
    outcome: ticket.title,
    contract_source: null,
    // A ticket's history is on the ticket file; a refusal is recorded on the
    // record a run with no ticket writes about itself, and there is none here.
    refusal: null,
    state: ticket.state,
    pull_request_url: ticket.delivery.pull_request_url,
    // The base a run resolved is recorded on the record a run with no ticket
    // writes about itself; a ticket's delivery does not carry one.
    base: null,
    // What the run that opened the pull request read on its head, and what
    // every `focrux sync` since has re-read.
    delivery_checks:
      ticket.delivery.checks_state === null
        ? null
        : { state: ticket.delivery.checks_state, checks: ticket.delivery.checks },
    handed_off: attribution === null ? null : attribution === "hand_off",
    // Carried through untouched: a reader comparing admission friction across
    // tickets is comparing what was recorded, not what this version can name.
    admission: ticket.admission,
    source: ticket.source,
    queue: queueStanding(storeDirectory, ticket),
    runs_started: runsStartedBy(ticket),
  };
};

/**
 * Where the ticket stands, read from the store as `focrux serve` reads it:
 * the whole store in queue order, then the tickets holding a place. Ordered
 * before the filter, as the queue orders it, because a settled dependency
 * still decides where its dependants fall in the order. The queue itself is
 * not asked; what it decided last is on the ticket's own scheduling record.
 */
function queueStanding(storeDirectory: string, ticket: DisplayTicket): QueueStanding {
  const holding = queueOrder(listTickets(storeDirectory)).filter((each) =>
    (QUEUE_HOLDING_STATES as readonly string[]).includes(each.state),
  );
  const index = holding.findIndex((each) => each.key === ticket.key);
  return {
    place: index === -1 ? null : index + 1,
    holding: holding.length,
    depends_on: ticket.depends_on,
    waits: describeScheduling(ticket.scheduling, ticket.state),
  };
}

/**
 * What a name on the command line stands for: the ticket, or — where no ticket
 * answers to it — the run that does (SCP-180).
 *
 * `focrux` keeps both in one store: `focrux run --outcome …` writes its
 * attempts beside an admitted ticket's, under the id its own contract is keyed
 * by and with no ticket file at all. The ticket store is asked first, so a
 * store holding both is read exactly the way it always was, and the fallback is
 * the resolver a run with nothing admitted uses — one answer to "what is this
 * id", not two.
 */
export const ticketSubject: ResolveSubject = (storeDirectory, key): InspectSubject => {
  if (existsSync(join(storeDirectory, "tickets", `${key}.json`))) {
    return ticketFileSubject(storeDirectory, key);
  }
  try {
    return attemptsRecordSubject(storeDirectory, key);
  } catch (unrecorded) {
    if (!(unrecorded instanceof UsageError)) throw unrecorded;
    // The name is neither. The ticket store's own refusal leads, because it
    // lists the tickets and a mistyped key is the common case; what has run
    // here without one is appended, because "no ticket FCX-9" is the wrong
    // whole answer in a store whose work has no tickets in it at all.
    try {
      return ticketFileSubject(storeDirectory, key);
    } catch (noTicket) {
      if (!(noTicket instanceof TicketStoreError)) throw noTicket;
      throw new TicketStoreError(`${noTicket.message}; ${unrecorded.message}`);
    }
  }
};

/** The report for one admitted ticket, by the key a person typed. */
export function buildInspectReport(input: {
  storeDirectory: string;
  key: string;
  attempt: string | null;
  /** Where an unreadable verdicts file is named; the report itself is still built. */
  streams?: Streams | undefined;
}): InspectReport {
  return buildReport({
    storeDirectory: input.storeDirectory,
    subject: ticketSubject(input.storeDirectory, input.key),
    attempt: input.attempt,
    streams: input.streams,
  });
}

/** `focrux inspect`, resolving the key against the ticket store. */
export function runInspectCommand(input: Omit<InspectOptions, "subject">): Promise<number> {
  return runInspect({ ...input, subject: ticketSubject });
}

export * from "./inspect-core.js";
