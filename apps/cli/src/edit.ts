import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXIT_CODES,
  PlanContractSchema,
  TicketSchema,
  compareLevels,
  hasAcceptanceCriteria,
  type AcceptanceCriterion,
  type PlanContract,
  type PlanLevel,
  type Scope,
  type Ticket,
} from "@focrux/contracts";
import { contractEditCount } from "@focrux/planning";
import {
  assembleContract,
  chooseLevel,
  parseCriterion,
  recordedEdits,
  type ManualVerifier,
  type Streams,
} from "./admit.js";
import { UsageError } from "./args.js";
import {
  DRAFT_SNAPSHOT_VERSION,
  assertContractMatches,
  contextManifestHash,
  contractPathFor,
  readContract,
  readDraftSnapshotFile,
  readTicket,
  storeDir,
  writeContract,
  writeDraftSnapshot,
  writeTicket,
  type DraftSnapshot,
} from "./tickets.js";

/**
 * `focrux edit KEY` — the person's half of a drafted contract.
 *
 * Opens `<KEY>.contract.json` in `$VISUAL` or `$EDITOR`, by argv, and
 * re-validates the file when the editor returns. A contract that no longer
 * parses is refused with its issues listed and **left as edited**, so the
 * person fixes their text rather than losing it. Only a ticket in
 * `plan_review` may be edited: an approved contract is immutable (ADR-0016).
 *
 * `--outcome`, `--criterion` and `--path` edit without an editor, for scripts
 * and tests; each replaces the whole of its part.
 *
 * After either kind of edit the level is derived again from the new scope and
 * the context manifest hash is recomputed — a scope that grew into `auth/` is
 * P2 whether or not the person changed the `level` field, and a person may
 * not set a level below the derivation (D-010).
 */

export interface EditArgs {
  repo: string;
  store: string | null;
  outcome: string | null;
  criteria: string[];
  paths: string[];
  manualReviewer: string | null;
  manualReason: string | null;
  json: boolean;
}

export interface EditInput {
  argv: string[];
  streams: Streams;
  cwd: string;
  now?: Date;
  /** Where `VISUAL` and `EDITOR` are read from. Tests supply one. */
  env?: NodeJS.ProcessEnv;
}

const takeValue = (rest: readonly string[], index: number, token: string): string => {
  const next = rest[index];
  if (next === undefined) throw new UsageError(`${token} requires a value`);
  return next;
};

export function parseEditArgs(argv: readonly string[]): { key: string; args: EditArgs } {
  const [key, ...rest] = argv;
  if (!key || key.startsWith("--")) throw new UsageError("edit requires a ticket key, e.g. FCX-1");
  const args: EditArgs = {
    repo: ".",
    store: null,
    outcome: null,
    criteria: [],
    paths: [],
    manualReviewer: null,
    manualReason: null,
    json: false,
  };
  const tokens = rest.flatMap((token) => {
    if (!token.startsWith("--")) return [token];
    const eq = token.indexOf("=");
    return eq === -1 ? [token] : [token.slice(0, eq), token.slice(eq + 1)];
  });
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    switch (token) {
      case "--repo":
        args.repo = takeValue(tokens, ++i, token);
        break;
      case "--store":
        args.store = takeValue(tokens, ++i, token);
        break;
      case "--outcome":
        args.outcome = takeValue(tokens, ++i, token);
        break;
      case "--criterion":
        args.criteria.push(takeValue(tokens, ++i, token));
        break;
      case "--path":
        args.paths.push(takeValue(tokens, ++i, token));
        break;
      case "--manual-reviewer":
        args.manualReviewer = takeValue(tokens, ++i, token);
        break;
      case "--manual-reason":
        args.manualReason = takeValue(tokens, ++i, token);
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new UsageError(`unknown option '${token}' for edit`);
    }
  }
  return { key, args };
}

const IDENTITY = ["plan_id", "ticket_id", "version"] as const;

/**
 * The contract on disk, or null when a previous edit left it unparseable. An
 * editor is the way to fix that file, so the interactive path must be able to
 * open it; the non-interactive one refuses and says so.
 */
function readContractIfValid(dir: string, key: string): PlanContract | null {
  try {
    return readContract(dir, key);
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
      return null;
    }
    throw error;
  }
}

/** The editor, split on whitespace so `EDITOR="code --wait"` works, still argv. */
function editorFrom(env: NodeJS.ProcessEnv): { binary: string; args: string[] } {
  const raw = (env.VISUAL ?? "").trim() || (env.EDITOR ?? "").trim();
  if (!raw) {
    throw new UsageError(
      "no editor is set. Export VISUAL or EDITOR with the editor's path (for example: " +
        'export EDITOR=vim), or edit without one: focrux edit KEY --outcome "..." ' +
        '--criterion "what :: how it is proven" --path "src/**"',
    );
  }
  const [binary, ...args] = raw.split(/\s+/);
  return { binary: binary!, args };
}

/** Open the file, wait, then read back what the person left there. */
function editInteractively(
  path: string,
  key: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  streams: Streams,
): PlanContract {
  const editor = editorFrom(env);
  const result = spawnSync(editor.binary, [...editor.args, path], { cwd, stdio: "inherit" });
  if (result.error) {
    throw new UsageError(
      `could not start the editor '${editor.binary}': ${result.error.message}. The contract is unchanged`,
    );
  }
  if (result.status !== 0) {
    streams.stderr(`warning: the editor exited with status ${result.status ?? "unknown"}\n`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new UsageError(
      `${key}'s contract is not JSON after the edit (${error instanceof Error ? error.message : String(error)}). ` +
        `The file is left as you edited it: fix it, then run focrux edit ${key} again`,
    );
  }
  const parsed = PlanContractSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(contract)"}: ${issue.message}`,
    );
    throw new UsageError(
      `${key}'s contract no longer parses after the edit (${issues.length} issue` +
        `${issues.length === 1 ? "" : "s"}):\n${issues.join("\n")}\n` +
        `The file is left as you edited it: fix it, then run focrux edit ${key} again`,
    );
  }
  return parsed.data;
}

function assertIdentityKept(before: PlanContract, after: PlanContract, key: string): void {
  const moved: string[] = IDENTITY.filter((field) => before[field] !== after[field]);
  if (JSON.stringify(before.base) !== JSON.stringify(after.base)) moved.push("base");
  if (moved.length > 0) {
    throw new UsageError(
      `${key}'s edit changed ${moved.join(", ")}, which identify the contract and the tree it was ` +
        "captured against; an edit changes the outcome, the criteria and the scope only. The file " +
        `is left as you edited it: restore those fields, then run focrux edit ${key} again`,
    );
  }
}

export async function runEditCommand(input: EditInput): Promise<number> {
  const { key, args } = parseEditArgs(input.argv);
  return runEdit({ key, args, streams: input.streams, cwd: input.cwd, now: input.now, env: input.env });
}

/**
 * The edit with its arguments already built, for a caller that holds them as
 * values rather than as a command line — the queue's endpoint, whose inputs
 * are a session's strings and must never be parsed as flags.
 */
export async function runEdit(input: {
  key: string;
  args: EditArgs;
  streams: Streams;
  cwd: string;
  now?: Date | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}): Promise<number> {
  const now = input.now ?? new Date();
  const { key, args } = input;
  const { streams } = input;
  const dir = storeDir(resolve(input.cwd, args.repo), args.store);

  const ticket = readTicket(dir, key);
  if (ticket.approved_at !== null) {
    throw new UsageError(
      `${key} was approved at ${ticket.approved_at}, and an approved contract is immutable ` +
        "(ADR-0016). A change to it is new work: admit it",
    );
  }
  if (ticket.state !== "plan_review") {
    throw new UsageError(`${key} is ${ticket.state}; only a ticket in plan_review may be edited`);
  }
  const interactive = args.outcome === null && args.criteria.length === 0 && args.paths.length === 0;
  const path = contractPathFor(dir, key);

  // What the edit is measured against: the contract as it stands, or — when a
  // previous edit left the file unparseable — the copy in the draft snapshot,
  // which admission and every edit since have kept in step with it and which
  // carries the same identity and base.
  //
  // A draft file that is there and does not parse is read as no snapshot at
  // all, and this command writes a new one over it. It has to: this is the
  // command approval sends a person to when the pair is broken, including when
  // what broke it was a text editor that left the JSON invalid, and a remedy
  // that fails on the state it is the remedy for is not one. What is lost with
  // it — how the contract was drafted, what earlier edits changed — is said out
  // loud rather than dropped quietly.
  const onDisk = readContractIfValid(dir, key);
  const draft = readDraftSnapshotFile(dir, key);
  if (draft.kind === "unreadable") {
    streams.stderr(
      `warning: ${key}.draft.json cannot be read: ${draft.reason}. It is replaced by this edit, ` +
        "and what it recorded about the drafting is lost; restore it from version control first " +
        "if you want it back.\n",
    );
  }
  const snapshot = draft.kind === "snapshot" ? draft.snapshot : null;
  const before = onDisk ?? snapshot?.contract ?? null;
  if (onDisk) assertContractMatches(ticket, onDisk);
  if (before === null) {
    throw new UsageError(
      `${key}'s contract does not parse and no draft snapshot exists to measure an edit against; ` +
        "restore the file from version control",
    );
  }
  if (onDisk === null && !interactive) {
    throw new UsageError(
      `${key}'s contract does not parse after an earlier edit; open it to fix it: focrux edit ${key}`,
    );
  }

  let outcome: string;
  let criteria: AcceptanceCriterion[];
  let scope: Scope;
  let requested: PlanLevel | null;
  let edited: PlanContract;
  if (interactive) {
    edited = editInteractively(path, key, input.env ?? process.env, input.cwd, streams);
    assertIdentityKept(before, edited, key);
    if (!hasAcceptanceCriteria(edited)) {
      throw new UsageError(
        `${key}'s edit set level P0, which carries no acceptance criteria, so nothing could ` +
          `review it. The file is left as you edited it: restore a level, then run focrux edit ${key} again`,
      );
    }
    outcome = edited.outcome;
    criteria = edited.acceptance_criteria;
    scope = edited.scope;
    // A level left as it was is not a request — the scope decides again. A
    // level raised above what stood is a raise; one written below it is an
    // attempt to lower, which the derivation refuses unless the new scope
    // genuinely derives that low.
    const movement = compareLevels(edited.level, before.level);
    requested =
      movement !== 0
        ? edited.level
        : ticket.admission.level_source === "raised"
          ? before.level
          : null;
  } else {
    edited = before;
    if (!hasAcceptanceCriteria(before)) {
      throw new UsageError(`${key} is ${before.level}, which cannot be edited into a reviewable contract`);
    }
    const manual: ManualVerifier = { reviewer: args.manualReviewer, reason: args.manualReason };
    outcome = args.outcome ?? before.outcome;
    criteria =
      args.criteria.length > 0
        ? args.criteria.map((raw, index) => parseCriterion(raw, index, manual))
        : before.acceptance_criteria;
    scope = args.paths.length > 0 ? { ...before.scope, paths_allowed: args.paths } : before.scope;
    // A level a person raised stays raised; a derived one is derived again.
    requested = ticket.admission.level_source === "raised" ? before.level : null;
  }

  const level = chooseLevel(scope, requested);
  const contract = assembleContract({
    identity: { plan_id: before.plan_id, version: before.version, ticket_id: before.ticket_id },
    level,
    outcome,
    criteria,
    scope,
    base: {
      ...before.base,
      context_manifest_hash: contextManifestHash({ base_commit: before.base.base_commit, ...scope }),
    },
    existing: edited,
  });
  writeContract(dir, ticket, contract);

  // The draft file is re-sealed with the same contract, and what this edit
  // changed is appended to it. Both halves matter: `approve` refuses a ticket
  // whose two contracts differ, so an edit that wrote only one of them would
  // make this command the thing that breaks the ticket; and with the two held
  // in step, the record kept here is the only remaining evidence of what a
  // person changed, which `admission.edit_count` is read from.
  //
  // A ticket that has never been counter-sealed — admitted before the pair was
  // kept in step, and possibly edited by that version too — is sealed here, so
  // it is sealed from its first edit onwards rather than never. Whatever its
  // contract had already drifted from the snapshot is written in first, at the
  // time the ticket was last touched: for such a store that difference is what
  // the earlier edits did, it is the number that version reported, and starting
  // the count from zero here would lose it.
  const diff = contractEditCount(before, contract);
  const applied = { at: now.toISOString(), changes: diff.changes };
  const earlier =
    snapshot && ticket.admission.counter_sealed_at === null
      ? contractEditCount(snapshot.contract, before).changes
      : [];
  const resealed: DraftSnapshot = snapshot
    ? {
        ...snapshot,
        contract,
        edits: [
          ...snapshot.edits,
          ...(earlier.length > 0 ? [{ at: ticket.updated_at, changes: earlier }] : []),
          applied,
        ],
      }
    : {
        schema_version: DRAFT_SNAPSHOT_VERSION,
        key,
        rendered_at: ticket.admitted_at,
        criteria_source: ticket.admission.criteria_source,
        contract,
        edits: [applied],
        // Nothing to record: whatever the model proposed, if a model did, was
        // not kept, and inventing a provenance here would be worse than the
        // absence it is standing in for.
        draft: null,
      };
  writeDraftSnapshot(dir, resealed);

  const updated: Ticket = TicketSchema.parse({
    ...ticket,
    title: contract.outcome,
    updated_at: now.toISOString(),
    admission: {
      ...ticket.admission,
      // Read back from the record just written, so the count a person sees
      // before approval is the one `approve` will report: every field edited at
      // least once, across every edit this ticket has had.
      edit_count: recordedEdits(resealed).count,
      // Both files have just been written from `contract`. From here approval
      // and execution require them to agree.
      counter_sealed_at: now.toISOString(),
      level_source: level.source,
      derived_level: level.derivation.level,
    },
  });
  writeTicket(dir, updated);

  if (args.json) {
    streams.stdout(`${JSON.stringify({ ticket: updated, contract, changes: diff.changes }, null, 2)}\n`);
    return EXIT_CODES.approve;
  }
  const levelNote =
    contract.level === before.level
      ? ""
      : `  level     ${before.level} -> ${contract.level} (${level.derivation.reasons.join("; ")})\n`;
  streams.stderr(
    `${key} edited: ${diff.count} change${diff.count === 1 ? "" : "s"}` +
      (diff.count > 0 ? ` (${diff.changes.join(", ")})` : "") +
      "\n" +
      levelNote +
      `\nRead it once more, then approve it:\n  focrux approve ${key}\n`,
  );
  return EXIT_CODES.approve;
}
