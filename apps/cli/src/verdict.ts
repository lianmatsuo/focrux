import { type Ticket } from "@focrux/contracts";
import { UsageError } from "./args.js";
import { buildInspectReport, ticketSubject } from "./inspect.js";
import type { InspectSubject, ResolveSubject } from "./inspect-core.js";
import { listTickets } from "./tickets.js";
import { runVerdictCommand as runVerdict, type VerdictOptions } from "./verdict-core.js";
import type { Streams } from "./streams.js";

/**
 * `focrux verdict`, with the ticket store behind it.
 *
 * The command itself is in `verdict-core.js`, which both builds carry: a
 * decision a person takes about this checkout is local by definition. What is
 * here is the one thing only admitted history can answer — which ticket a
 * reference names, whether it was typed as a key, as the pull request the
 * ticket is behind, or as the id of a review that ran on it.
 */

/** The pull request number a reference names, whichever way it was written. */
function pullRequestNumber(reference: string): number | null {
  const plain = /^#?(\d+)$/.exec(reference);
  if (plain) return Number(plain[1]);
  const inUrl = /\/(?:pull|pulls|merge_requests)\/(\d+)(?:[/?#]|$)/.exec(reference);
  return inUrl ? Number(inUrl[1]) : null;
}

/**
 * The ticket a reference names. A ticket key first, then the pull request —
 * by url as the ticket recorded it, then by number — and then a review id,
 * which costs a read of every ticket's bundles and so is asked last.
 */
export function resolveReview(dir: string, reference: string): Ticket {
  const tickets = listTickets(dir);
  const byKey = tickets.find((ticket) => ticket.key === reference);
  if (byKey !== undefined) return byKey;

  const byUrl = tickets.filter((ticket) => ticket.delivery.pull_request_url === reference);
  if (byUrl.length > 0) return one(byUrl, reference, "pull request");

  const number = pullRequestNumber(reference);
  if (number !== null) {
    const byNumber = tickets.filter((ticket) => ticket.delivery.pull_request_number === number);
    if (byNumber.length > 0) return one(byNumber, reference, "pull request");
  }

  if (reference.startsWith("rev_")) {
    const byReview = tickets.filter((ticket) =>
      buildInspectReport({ storeDirectory: dir, key: ticket.key, attempt: null }).attempts.some(
        (attempt) =>
          attempt.review?.review_id === reference ||
          attempt.bundles.some((bundle) => bundle.subject_id === reference),
      ),
    );
    if (byReview.length > 0) return one(byReview, reference, "review");
  }

  throw new UsageError(
    `no review in ${dir} is '${reference}': it matches no ticket key, no pull request on a ` +
      `ticket and no review id. \`focrux list --all\` names the tickets this store holds`,
  );
}

function one(matches: readonly Ticket[], reference: string, what: string): Ticket {
  if (matches.length === 1) return matches[0]!;
  throw new UsageError(
    `${what} '${reference}' is on ${matches.length} tickets (${matches
      .map((ticket) => ticket.key)
      .join(", ")}); name the one you mean by its key`,
  );
}

/** The work a reference names, as the report and the record need it. */
export const ticketReviewSubject: ResolveSubject = (dir, reference): InspectSubject =>
  ticketSubject(dir, resolveReview(dir, reference).key);

/** `focrux verdict`, resolving the reference against the ticket store. */
export function runVerdictCommand(
  input: Omit<VerdictOptions, "resolve"> & { streams: Streams },
): Promise<number> {
  return runVerdict({ ...input, resolve: ticketReviewSubject });
}

export * from "./verdict-core.js";
