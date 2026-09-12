import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseUnifiedDiff } from "@focrux/contracts";
import type { Ticket } from "@focrux/contracts";
import type { TaskSummary, UsageLedger } from "../shared/protocol.js";

/**
 * Reads of the CLI's own records that the desktop makes directly: the attempts
 * record the loop appends to and the bundle manifests it seals. Only the fields
 * a card, a row or the ledger needs are named; a record written by a later
 * version still parses.
 */
export const StoredAttemptSchema = z.looseObject({
  attempt_id: z.string().min(1),
  branch: z.string().min(1).optional(),
  created_at: z.string().optional(),
  usage: z
    .looseObject({
      cost_micros: z.number().int().min(0).optional(),
      cost_basis: z.string().optional(),
      wall_clock_ms: z.number().int().min(0).optional(),
    })
    .optional(),
  termination: z.looseObject({ reason: z.string() }).optional(),
});
export type StoredAttempt = z.infer<typeof StoredAttemptSchema>;
const AttemptsRecordSchema = z.looseObject({
  ticket_id: z.string().min(1),
  attempts: z.array(StoredAttemptSchema),
});
const BundleManifestSchema = z.looseObject({
  bundle_id: z.string().min(1),
  kind: z.string(),
  subject_id: z.string(),
  ticket_id: z.string(),
  artifacts: z
    .array(
      z.looseObject({
        name: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        bytes: z.number().int().min(0),
        retained: z.boolean(),
      }),
    )
    .default([]),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

const CEILING_REASONS = new Set([
  "wall_clock_exceeded",
  "command_ceiling_exceeded",
  "iteration_ceiling_exceeded",
  "round_iteration_ceiling_exceeded",
  "token_ceiling_exceeded",
  "cost_ceiling_exceeded",
]);
export const isCeilingStop = (reason: string | undefined): boolean =>
  reason !== undefined && CEILING_REASONS.has(reason);
/** A priced attempt reported a cost; `unavailable` and `not_incurred` are not zero dollars. */
export const isPriced = (attempt: StoredAttempt): boolean =>
  attempt.usage?.cost_micros !== undefined &&
  !["unavailable", "not_incurred"].includes(
    attempt.usage.cost_basis ?? "transport_reported",
  );

export function readAttempts(path: string): {
  attempts: StoredAttempt[];
  error: string | null;
} {
  if (!existsSync(path)) return { attempts: [], error: null };
  try {
    const parsed = AttemptsRecordSchema.safeParse(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return parsed.success
      ? { attempts: parsed.data.attempts, error: null }
      : { attempts: [], error: "The attempts record could not be read." };
  } catch {
    return { attempts: [], error: "The attempts record could not be read." };
  }
}

export function listBundles(directory: string): BundleManifest[] {
  if (!existsSync(directory)) return [];
  const manifests: BundleManifest[] = [];
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = BundleManifestSchema.safeParse(
        JSON.parse(readFileSync(join(directory, name), "utf8")),
      );
      if (parsed.success) manifests.push(parsed.data);
    } catch {
      // A manifest that is not JSON is stepped over, as the CLI steps over it.
    }
  }
  return manifests;
}

/** One retained object, read only when it is a regular file of the recorded size and hash, and under the display limit. */
export function readObject(
  path: string,
  artifact: { name: string; sha256: string; bytes: number },
): { text: string; note: null } | { text: null; note: string } {
  if (!existsSync(path))
    return {
      text: null,
      note:
        artifact.name + " was recorded but its bytes are no longer available.",
    };
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 2_000_000)
      return {
        text: null,
        note:
          artifact.name +
          " exceeds the 2 MB desktop display limit or is not a regular file.",
      };
    const buffer = Buffer.alloc(stat.size + 1);
    const bytes = buffer.subarray(
      0,
      readSync(descriptor, buffer, 0, buffer.length, 0),
    );
    if (
      bytes.length !== artifact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
    )
      return {
        text: null,
        note:
          artifact.name +
          " does not match its recorded content hash; it has not been displayed.",
      };
    return { text: bytes.toString("utf8"), note: null };
  } finally {
    closeSync(descriptor);
  }
}

const diffTotals = new Map<
  string,
  { files: number; additions: number; deletions: number }
>();
/** Totals of a sealed diff, cached by content hash: an object never changes under its hash. */
export function diffSummary(
  objectsDirectory: string,
  artifact: { name: string; sha256: string; bytes: number },
): {
  totals: { files: number; additions: number; deletions: number } | null;
  note: string | null;
} {
  const cached = diffTotals.get(artifact.sha256);
  if (cached) return { totals: cached, note: null };
  let read: ReturnType<typeof readObject>;
  try {
    read = readObject(join(objectsDirectory, artifact.sha256), artifact);
  } catch {
    return {
      totals: null,
      note: artifact.name + " could not be read from the bundle store.",
    };
  }
  if (read.text === null) return { totals: null, note: read.note };
  const files = parseUnifiedDiff(read.text);
  const totals = {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
  diffTotals.set(artifact.sha256, totals);
  return { totals, note: null };
}

/** The card's account of one ticket: its branch, what its attempts cost, and the latest sealed diff. */
export function summariseTicket(input: {
  ticket: Ticket;
  attempts: StoredAttempt[];
  attemptsError: string | null;
  bundles: BundleManifest[];
  objectsDirectory: string;
}): TaskSummary {
  const { ticket, attempts, bundles } = input;
  const latest = attempts.at(-1);
  const priced = attempts.filter(isPriced);
  const notes: string[] = [];
  if (input.attemptsError) notes.push(input.attemptsError);
  let diff: TaskSummary["diff"] = null;
  if (latest) {
    const execution = bundles.find(
      (bundle) =>
        bundle.kind === "execution" &&
        bundle.subject_id === latest.attempt_id &&
        bundle.ticket_id === ticket.ticket_id,
    );
    const artifact = execution?.artifacts.find(
      (entry) => entry.name === "change.diff" && entry.retained,
    );
    if (artifact) {
      const summary = diffSummary(input.objectsDirectory, artifact);
      diff = summary.totals;
      if (summary.note) notes.push(summary.note);
    } else if (execution)
      notes.push("The latest attempt's diff was not retained.");
  }
  return {
    branch: ticket.delivery.branch ?? latest?.branch ?? null,
    attempts: attempts.length,
    latestAttemptAt: latest?.created_at ?? null,
    costMicros: priced.length
      ? priced.reduce(
          (sum, attempt) => sum + (attempt.usage?.cost_micros ?? 0),
          0,
        )
      : null,
    costBasis:
      attempts.length === 0
        ? "none"
        : priced.length === attempts.length
          ? "priced"
          : "unpriced",
    diff,
    note: notes.length ? notes.join(" ") : null,
  };
}

const monthOf = (value: string | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0")
  );
};
export const currentMonth = (now = new Date()): string =>
  now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

/** What this machine spent in a month, from retained attempts alone: every number is a sum, never an estimate. */
export function ledgerFor(
  records: { ticket: Ticket; attempts: StoredAttempt[] }[],
  month: string,
): UsageLedger {
  const ledger: UsageLedger = {
    month,
    spentMicros: 0,
    pricedAttempts: 0,
    unpricedAttempts: 0,
    ticketsRun: 0,
    ticketsMerged: 0,
    stoppedAtCeiling: 0,
    averageMergedMicros: null,
  };
  let mergedSpend = 0,
    mergedPriced = 0;
  for (const { ticket, attempts } of records) {
    const inMonth = attempts.filter(
      (attempt) => monthOf(attempt.created_at) === month,
    );
    if (inMonth.length) ledger.ticketsRun++;
    // A ticket, not an attempt: three ceiling stops on one ticket read as one ticket stopped.
    if (inMonth.some((attempt) => isCeilingStop(attempt.termination?.reason)))
      ledger.stoppedAtCeiling++;
    for (const attempt of inMonth) {
      if (isPriced(attempt)) {
        ledger.pricedAttempts++;
        ledger.spentMicros += attempt.usage?.cost_micros ?? 0;
      } else ledger.unpricedAttempts++;
    }
    if (ticket.state === "merged" && monthOf(ticket.updated_at) === month) {
      ledger.ticketsMerged++;
      const priced = attempts.filter(isPriced);
      if (priced.length && priced.length === attempts.length) {
        mergedPriced++;
        mergedSpend += priced.reduce(
          (sum, attempt) => sum + (attempt.usage?.cost_micros ?? 0),
          0,
        );
      }
    }
  }
  ledger.averageMergedMicros = mergedPriced
    ? Math.round(mergedSpend / mergedPriced)
    : null;
  return ledger;
}
