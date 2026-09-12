import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";
import {
  AcceptanceCriterionSchema,
  EXIT_CODES,
  IllegalTransitionError,
  PlanContractSchema,
  QUEUE_HOLDING_STATES,
  TICKET_SCHEMA_VERSION,
  TicketSchema,
  VERIFICATION_KINDS,
  compareLevels,
  derivePlannedRisk,
  isActive,
  isConfigPath,
  isDependencyPath,
  isMigrationPath,
  isSecurityPath,
  ticketSourceLabel,
  transition,
  type AcceptanceCriterion,
  type PlanBase,
  type PlanContract,
  type PlanLevel,
  type RiskDerivation,
  type Scope,
  type Ticket,
  type TicketPriority,
  type VerificationKind,
} from "@focrux/contracts";
import {
  CONTRACT_DRAFT_JSON_SCHEMA,
  PlanningError,
  contractDifferences,
  contractEditCount,
  draftContract,
  fetchGitHubIssue,
  readIssueFile,
  type BoardEntry,
  type DraftResult,
  type GitHubIssue,
  type SourceIssue,
} from "@focrux/planning";
import {
  ProviderError,
  RepoReader,
  anthropicModel,
  claudeCliModel,
  codexCliModel,
  type ReviewModel,
} from "@focrux/review";
import { UsageError } from "./args.js";
import {
  TicketStoreError,
  assertContractMatches,
  contextManifestHash,
  headCommit,
  idsFor,
  listTickets,
  nextKey,
  readContract,
  readJudgingPaths,
  readDraftSnapshotFile,
  recordIssued,
  readTicket,
  repositoryId,
  storeDir,
  writeContract,
  writeDraftSnapshot,
  writeTicket,
  type DraftSnapshot,
  type DraftSnapshotFile,
  type JudgingRule,
} from "./tickets.js";
import { describeScheduling } from "./waits.js";

/**
 * `focrux admit`, `focrux approve`, `focrux list` — roadmap items 11 and 12.
 *
 * The friction these remove is specific and was measured by doing it by hand:
 * before this, starting a ticket meant hand-writing a `contract.json` with an
 * opaque `plan_id`, an opaque `ticket_id`, a 40-character `base_commit`, a
 * `context_manifest_hash` nobody could compute, criterion ids in sequence and a
 * `paths_prohibited` list copied from another file. Six of those eight are
 * derivable and one was a placeholder.
 *
 * ## The model drafts; the person approves
 *
 * `focrux admit --from owner/repo#N` asks a model to draft the contract —
 * outcome, acceptance criteria and a *proposed* scope — from the issue, the
 * way the Admit artboard shows it. `--from-file <path>` drafts from a pasted
 * Markdown file instead, for work that never reached a tracker: the first line
 * is the title, the rest is the body, and the file is external-trust data
 * exactly as an issue body is — local is convenient, not trusted. The two are
 * mutually exclusive, take the same path through the model and produce the same
 * candidate. The draft is written beside the ticket as
 * `<KEY>.draft.json` and rendered; the person edits any of it and approves
 * what they end up with. **A draft is never executed; only an approved
 * contract is.** The person's `approve` is the authority boundary under
 * ADR-0023 §4: a scope glob a model proposed becomes an action parameter only
 * after a human has confirmed it (the founder's decision, 2026-09-02). Typed
 * admission — `--outcome`, `--criterion`, `--path` — calls no model.
 *
 * ## Level is derived, not chosen
 *
 * The plan level comes from `derivePlannedRisk` over the declared scope
 * (docs/04). `--level` may raise it and may not lower it (D-010). A P2
 * contract's additional fields are derived from the same scope; a P3
 * contract's decision fields are a person's to state, and `approve` refuses
 * one where they still are not.
 */

/** The prohibited paths every admitted ticket starts with. */
const DEFAULT_PROHIBITED = [".github/**", "infra/**", "**/*.pem", "**/.env*"];
/** Exempt from scope accounting: they change on every install or codegen run. */
const DEFAULT_GENERATED = ["pnpm-lock.yaml", "package-lock.json", "**/*.generated.ts"];
const DEFAULT_EXPANSION_BUDGET = 3;
const DEFAULT_PREFIX = "FCX";

export type DraftProvider = "anthropic" | "claude-cli" | "codex-cli";

export interface AdmitArgs {
  repo: string;
  store: string | null;
  prefix: string;
  title: string | null;
  criteria: string[];
  criteriaFile: string | null;
  paths: string[];
  prohibited: string[];
  generated: string[];
  expansionBudget: number;
  /** Null means derived from the scope. A value may only raise the derivation. */
  level: "P1" | "P2" | "P3" | null;
  priority: TicketPriority;
  labels: string[];
  dependsOn: string[];
  source: string | null;
  sourceUrl: string | null;
  /** `owner/repo#N`: draft the contract from this issue with a model. */
  from: string | null;
  /** A Markdown file holding a pasted issue: draft the contract from it instead. */
  fromFile: string | null;
  provider: DraftProvider;
  model: string | null;
  manualReviewer: string | null;
  manualReason: string | null;
  approve: boolean;
  json: boolean;
}

export interface ListArgs {
  repo: string;
  store: string | null;
  all: boolean;
  json: boolean;
}

export interface Streams {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  isTTY: boolean;
}

const takeValue = (rest: string[], index: number, token: string): string => {
  const next = rest[index];
  if (next === undefined) throw new UsageError(`${token} requires a value`);
  return next;
};

/**
 * Split `--name=value` into `["--name", "value"]`, leaving everything else
 * alone, so `--outcome=x` and `--outcome x` mean the same thing.
 *
 * `parseReviewArgs` has always accepted both forms. These commands did not, so
 * one binary rejected `--outcome=x` and accepted `--contract=x` — a difference
 * nobody chose and nothing documented.
 */
function splitInlineValues(argv: readonly string[]): string[] {
  return argv.flatMap((token) => {
    if (!token.startsWith("--")) return [token];
    const eq = token.indexOf("=");
    return eq === -1 ? [token] : [token.slice(0, eq), token.slice(eq + 1)];
  });
}

export function parseAdmitArgs(argv: readonly string[]): AdmitArgs {
  const args: AdmitArgs = {
    repo: ".",
    store: null,
    prefix: DEFAULT_PREFIX,
    title: null,
    criteria: [],
    criteriaFile: null,
    paths: [],
    prohibited: [...DEFAULT_PROHIBITED],
    generated: [...DEFAULT_GENERATED],
    expansionBudget: DEFAULT_EXPANSION_BUDGET,
    level: null,
    priority: "normal",
    labels: [],
    dependsOn: [],
    source: null,
    sourceUrl: null,
    from: null,
    fromFile: null,
    provider: "claude-cli",
    model: null,
    manualReviewer: null,
    manualReason: null,
    approve: false,
    json: false,
  };
  const tokens = splitInlineValues(argv);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    switch (token) {
      case "--repo":
        args.repo = takeValue(tokens, ++i, token);
        break;
      case "--store":
        args.store = takeValue(tokens, ++i, token);
        break;
      case "--prefix": {
        const prefix = takeValue(tokens, ++i, token);
        // Checked here rather than reaching TicketKeySchema, where the failure
        // arrived as `error: the review did not complete: ZodError…` with a
        // stack trace and exit 3 — for a command that is not a review.
        if (!/^[A-Z][A-Z0-9]{1,9}$/.test(prefix)) {
          throw new UsageError(
            `--prefix must be 2 to 10 uppercase letters or digits starting with a letter, so a ` +
              `key reads like FCX-118. Got '${prefix}'`,
          );
        }
        args.prefix = prefix;
        break;
      }
      case "--outcome":
      case "--title":
        args.title = takeValue(tokens, ++i, token);
        break;
      case "--criterion":
        args.criteria.push(takeValue(tokens, ++i, token));
        break;
      case "--criteria-file":
        args.criteriaFile = takeValue(tokens, ++i, token);
        break;
      case "--path":
        args.paths.push(takeValue(tokens, ++i, token));
        break;
      case "--prohibit":
        args.prohibited.push(takeValue(tokens, ++i, token));
        break;
      case "--generated":
        args.generated.push(takeValue(tokens, ++i, token));
        break;
      case "--expansion-budget": {
        const raw = takeValue(tokens, ++i, token);
        const budget = Number(raw);
        if (!Number.isInteger(budget) || budget < 0) {
          throw new UsageError(`--expansion-budget must be a whole number of files. Got '${raw}'`);
        }
        args.expansionBudget = budget;
        break;
      }
      case "--level": {
        const level = takeValue(tokens, ++i, token);
        if (level !== "P1" && level !== "P2" && level !== "P3") {
          throw new UsageError(
            `--level must be P1, P2 or P3; P0 carries no acceptance criteria, so nothing could ` +
              "review it",
          );
        }
        args.level = level;
        break;
      }
      case "--priority": {
        const priority = takeValue(tokens, ++i, token);
        if (!["urgent", "high", "normal", "low"].includes(priority)) {
          throw new UsageError(`--priority must be urgent, high, normal or low`);
        }
        args.priority = priority as TicketPriority;
        break;
      }
      case "--label":
        args.labels.push(takeValue(tokens, ++i, token));
        break;
      case "--depends-on": {
        const key = takeValue(tokens, ++i, token);
        if (!/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,6}$/.test(key)) {
          throw new UsageError(`--depends-on must be a ticket key like FCX-2. Got '${key}'`);
        }
        args.dependsOn.push(key);
        break;
      }
      case "--source":
        args.source = takeValue(tokens, ++i, token);
        break;
      case "--source-url": {
        const url = takeValue(tokens, ++i, token);
        try {
          new URL(url);
        } catch {
          throw new UsageError(`--source-url must be a URL. Got '${url}'`);
        }
        args.sourceUrl = url;
        break;
      }
      case "--from": {
        const reference = takeValue(tokens, ++i, token);
        if (!/^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(reference)) {
          throw new UsageError(`--from must be a GitHub issue like owner/repo#412. Got '${reference}'`);
        }
        args.from = reference;
        break;
      }
      case "--from-file":
        args.fromFile = takeValue(tokens, ++i, token);
        break;
      case "--provider": {
        const provider = takeValue(tokens, ++i, token);
        if (provider !== "anthropic" && provider !== "claude-cli" && provider !== "codex-cli") {
          throw new UsageError("--provider must be 'anthropic', 'claude-cli' or 'codex-cli'");
        }
        args.provider = provider;
        break;
      }
      case "--model":
        args.model = takeValue(tokens, ++i, token);
        break;
      case "--manual-reviewer":
        args.manualReviewer = takeValue(tokens, ++i, token);
        break;
      case "--manual-reason":
        args.manualReason = takeValue(tokens, ++i, token);
        break;
      case "--approve":
        args.approve = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new UsageError(`unknown option '${token}' for admit`);
    }
  }
  // Two sources for one draft is not a preference to resolve by picking one:
  // whichever lost would have been read as the thing being admitted, and the
  // ticket would carry the provenance of the other.
  if (args.from !== null && args.fromFile !== null) {
    throw new UsageError(
      `--from and --from-file are mutually exclusive: one contract is drafted from one issue. ` +
        `Got --from '${args.from}' and --from-file '${args.fromFile}'`,
    );
  }
  return args;
}

export function parseListArgs(argv: readonly string[]): ListArgs {
  const args: ListArgs = { repo: ".", store: null, all: false, json: false };
  const tokens = splitInlineValues(argv);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    switch (token) {
      case "--repo":
        args.repo = takeValue(tokens, ++i, token);
        break;
      case "--store":
        args.store = takeValue(tokens, ++i, token);
        break;
      case "--all":
        args.all = true;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        throw new UsageError(`unknown option '${token}' for list`);
    }
  }
  return args;
}

/**
 * `text :: assertion [:: kind]` — what must be proven, the assertion that will
 * prove it, and how: `test` (the default), `artifact`, `query`, `metric` or
 * `manual`. A documentation or decision ticket is proven by an artifact that
 * must exist, and nothing here assumes the proof is code.
 *
 * The separator is ` :: ` **with spaces around it**, not a bare `::`. A bare one
 * silently truncated any criterion containing a scope operator:
 * `"the parser handles std::vector :: a unit test asserts it"` became text
 * `"the parser handles std"` proven by `"vector"`, both non-empty, so no guard
 * fired and the contract was approved with a criterion that says nothing.
 * `::` is ordinary in C++, Rust, Ruby and PHP identifiers, which a code-review
 * product's criteria are full of.
 *
 * More than two separators is refused rather than resolved by picking an end:
 * if the sentence is ambiguous to a reader it is ambiguous to review.
 */
const CRITERION_SEPARATOR = " :: ";

export interface ManualVerifier {
  reviewer: string | null;
  reason: string | null;
}

export function parseCriterion(
  raw: string,
  index: number,
  manual: ManualVerifier = { reviewer: null, reason: null },
): AcceptanceCriterion {
  const parts = raw.split(CRITERION_SEPARATOR);
  if (parts.length > 3) {
    throw new UsageError(
      `criterion ${index + 1} contains ${parts.length - 1} ' :: ' separators, so which part is ` +
        "the assertion is ambiguous. Use one (text :: assertion) or two (text :: assertion :: kind)",
    );
  }
  const [text, assertion, kindRaw] = parts.map((part) => part.trim());
  if (!text) throw new UsageError(`criterion ${index + 1} is empty`);
  if (!assertion) {
    throw new UsageError(
      `criterion ${index + 1} has no assertion. Write it as "what must be true :: the assertion ` +
        `that proves it", with spaces around the ' :: ' — a criterion nothing can prove is the ` +
        "defect class this product exists to catch",
    );
  }
  if (kindRaw !== undefined && !(VERIFICATION_KINDS as readonly string[]).includes(kindRaw)) {
    throw new UsageError(
      `criterion ${index + 1} names verification kind '${kindRaw}'; it must be one of ` +
        `${VERIFICATION_KINDS.join(", ")} (test when the segment is left out)`,
    );
  }
  const kind = (kindRaw ?? "test") as VerificationKind;
  if (kind === "manual" && (!manual.reviewer || !manual.reason)) {
    throw new UsageError(
      `criterion ${index + 1} is proven manually, which needs --manual-reviewer <name> and ` +
        "--manual-reason <why it cannot be automated>: a criterion nobody can automate needs a " +
        "name against it",
    );
  }
  // Parsed rather than asserted: `ac_<n>` and the verification shape are both
  // schema-checked here, so a malformed criterion fails at the point a person
  // can still fix it rather than inside `PlanContractSchema.parse` later.
  return AcceptanceCriterionSchema.parse({
    id: `ac_${index + 1}`,
    text,
    expected_verification:
      kind === "manual"
        ? { kind, assertion, manual_reviewer: manual.reviewer, manual_reason: manual.reason }
        : { kind, assertion },
  });
}

function readCriteriaFile(path: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function sourceOf(args: AdmitArgs, issue: SourceIssue | null, path: string | null): Ticket["source"] {
  if (issue && path !== null) {
    // A pasted file is not a tracker and it is not nothing, so it has a kind of
    // its own. It used to be recorded as `none` with the path in the reference,
    // which made a file-sourced ticket indistinguishable from one that started
    // here except by looking at the string — and left `none`, the kind that
    // means "no reference", carrying one. `url` stays null unless a person
    // supplied one with --source-url.
    //
    // Resolved, not as typed: `--from-file issue.md` is read relative to where
    // the person was standing, and a ticket outlives that. Provenance is
    // written once and never refreshed, so a reference that only resolves from
    // one directory is one that stops resolving.
    return {
      kind: "file",
      reference: path,
      url: args.sourceUrl,
      title_at_admission: issue.title,
    };
  }
  if (issue) {
    return {
      kind: "github",
      reference: issue.reference,
      url: args.sourceUrl ?? issue.url ?? null,
      title_at_admission: issue.title,
    };
  }
  if (!args.source) {
    // A URL with nothing to attach it to is a lost reference, not a default.
    if (args.sourceUrl) {
      throw new UsageError("--source-url needs --source: a link with no reference to hang it on");
    }
    return { kind: "none", reference: null, url: null, title_at_admission: null };
  }
  const kind = /^[\w.-]+\/[\w.-]+#\d+$/.test(args.source)
    ? ("github" as const)
    : /^[A-Z][A-Z0-9]+-\d+$/.test(args.source)
      ? ("jira" as const)
      : /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(args.source)
        ? ("linear" as const)
        : (() => {
            // `linear` was the fallback, so `--source "slack-thread-2026-08"`
            // became a Linear issue permanently. Provenance is written once at
            // admission and never refreshed by design, so a guess here is wrong
            // for ever.
            throw new UsageError(
              `--source '${args.source}' is not a reference this recognises. Use owner/repo#123 ` +
                "for GitHub, or PROJ-45 for Jira or Linear",
            );
          })();
  return {
    kind,
    reference: args.source,
    url: args.sourceUrl,
    title_at_admission: null,
  };
}

/**
 * What a P3 decision field holds until a person states it. `approve` refuses a
 * contract that still carries it.
 */
export const UNSTATED = "not yet stated";

export interface LevelChoice {
  level: PlanLevel;
  source: "derived" | "raised";
  derivation: RiskDerivation;
}

/**
 * Derive the level from the scope; let `requested` raise it and never lower
 * it. Admission admits a reversible change to a standard repository — a
 * read-only action is P0, which carries no criteria and cannot be admitted,
 * and irreversibility is a property of what the change turns out to do.
 */
export function chooseLevel(scope: Scope, requested: PlanLevel | null): LevelChoice {
  const derivation = derivePlannedRisk({
    scope,
    repository_sensitivity: "standard",
    action_class: "reversible_change",
  });
  if (requested === null || requested === derivation.level) {
    return { level: derivation.level, source: "derived", derivation };
  }
  if (compareLevels(requested, derivation.level) < 0) {
    throw new UsageError(
      `--level ${requested} would lower the level this scope derives to, ${derivation.level} ` +
        `(${derivation.reasons.join("; ")}). A human may raise either level; a human may not ` +
        "lower it",
    );
  }
  return { level: requested, source: "raised", derivation };
}

/**
 * The fields a level adds to the P1 body.
 *
 * P2's are derived from the scope — statements about what it declares, not
 * placeholders. P3's decision fields are a person's: the record carries the
 * derivation and the rest is `UNSTATED` until `focrux edit` states them. A
 * value already on `existing` is kept, so an edit never erases what a person
 * wrote.
 */
export function levelAdditions(
  level: PlanLevel,
  scope: Scope,
  derivation: RiskDerivation,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  if (level === "P0" || level === "P1") return {};
  const named = (test: (path: string) => boolean) => scope.paths_allowed.filter(test);
  const migrations = named(isMigrationPath);
  const sensitive = [
    ...named(isSecurityPath).map((path) => `security-sensitive ${path}`),
    ...named(isDependencyPath).map((path) => `dependency manifest ${path}`),
    ...named(isConfigPath).map((path) => `configuration ${path}`),
  ];
  const keep = (key: string, derived: unknown) => (key in existing ? existing[key] : derived);
  const p2 = {
    data_impact: keep(
      "data_impact",
      migrations.length > 0
        ? `declared scope includes a migration path: ${migrations.join(", ")}`
        : "no schema or data migration path in the declared scope",
    ),
    security_impact: keep(
      "security_impact",
      sensitive.length > 0
        ? `declared scope includes ${sensitive.join("; ")}`
        : "no security-sensitive, dependency or configuration path in the declared scope",
    ),
    rollout: keep("rollout", "a human merges the pull request; nothing in this system deploys it"),
    rollback: keep(
      "rollback",
      "git revert of the merged pull request: the admitted action class is a reversible change",
    ),
    estimated_recurring_cost_micros: keep("estimated_recurring_cost_micros", 0),
  };
  if (level === "P2") return p2;
  return {
    ...p2,
    decision_record: keep("decision_record", `derived P3: ${derivation.reasons.join("; ")}`),
    named_approver: keep("named_approver", UNSTATED),
    alternatives: keep("alternatives", [UNSTATED]),
    contingency: keep("contingency", UNSTATED),
  };
}

/** Assemble and validate a contract at a level, keeping what a person already stated. */
export function assembleContract(args: {
  identity: { plan_id: string; version: number; ticket_id: string };
  level: LevelChoice;
  outcome: string;
  criteria: AcceptanceCriterion[];
  scope: Scope;
  base: PlanBase;
  existing?: PlanContract;
}): PlanContract {
  return PlanContractSchema.parse({
    ...args.identity,
    level: args.level.level,
    outcome: args.outcome,
    acceptance_criteria: args.criteria,
    scope: args.scope,
    base: args.base,
    ...levelAdditions(
      args.level.level,
      args.scope,
      args.level.derivation,
      (args.existing ?? {}) as Record<string, unknown>,
    ),
  });
}

/**
 * What `approve` will not sign: a P3 contract whose decision fields nobody has
 * stated. Approving them unstated would make the level a label rather than a
 * decision.
 */
/** The literal text before a glob's first wildcard: the part that names a real place. */
function staticPrefix(glob: string): string {
  const cut = glob.search(/[*?[{]/);
  return cut === -1 ? glob : glob.slice(0, cut);
}

/**
 * A scope that reaches into what judges the attempt is refused here, with the
 * reason, rather than at the seal after an attempt has run (D-045). Overlap is
 * decided on the static prefixes: either glob naming a place inside the other's
 * is an overlap. That refuses `packages/**` against a protected
 * `packages/review/**` too, deliberately — the answer is a narrower scope.
 */
/** `a/b` is inside `a/b/…` and is `a/b` itself; it is not inside `a/bc`. */
function inside(path: string, prefix: string): boolean {
  const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  return path === base || path.startsWith(`${base}/`);
}

export function judgingOverlap(
  allowed: readonly string[],
  judging: readonly JudgingRule[],
): Array<{ scope: string; judging: JudgingRule }> {
  const overlaps: Array<{ scope: string; judging: JudgingRule }> = [];
  for (const scope of allowed) {
    const s = staticPrefix(scope);
    for (const rule of judging) {
      const j = staticPrefix(rule.path);
      // A judging glob with no literal prefix (`**/*.pem`) names no place a
      // scope could be compared with; the seal still enforces it.
      if (j.length === 0) continue;
      // A scope with no literal prefix (`**`, `**/*.ts`) names every place,
      // so it reaches every judging path there is.
      if (s.length === 0 || inside(s, j) || inside(j, s)) overlaps.push({ scope, judging: rule });
    }
  }
  return overlaps;
}

export function assertApprovable(
  contract: PlanContract,
  key: string,
  judging: readonly JudgingRule[] = [{ path: ".focrux/**", source: "store" }],
): void {
  const overlaps = judgingOverlap(contract.scope.paths_allowed, judging);
  if (overlaps.length > 0) {
    throw new UsageError(
      `${key} cannot be approved: its scope reaches what judges the attempt — ` +
        // The source travels with the path: `scripts/validate_docs.py` alone
        // says a file is out of bounds, `checks[check_docs].definition_path`
        // says the scope was reaching for the check that grades the attempt.
        overlaps.map((o) => `${o.scope} overlaps protected ${o.judging.path} (${o.judging.source})`).join("; ") +
        `. The runner would refuse the change at the seal, after an attempt had been paid for. ` +
        `Narrow the scope: focrux edit ${key} --path <glob outside the protected paths>`,
    );
  }
  if (contract.level !== "P3") return;
  const unstated = (["decision_record", "named_approver", "alternatives", "contingency"] as const).filter(
    (field) => {
      const value = contract[field];
      return Array.isArray(value) ? value.includes(UNSTATED) : value === UNSTATED;
    },
  );
  if (unstated.length === 0) return;
  throw new UsageError(
    `${key} derives to P3 and ${unstated.join(", ")} ${unstated.length === 1 ? "is" : "are"} ` +
      `not yet stated. These are decisions only a person makes: focrux edit ${key}, state them, ` +
      "then approve",
  );
}

/**
 * The contract in `<KEY>.contract.json` against its counter-seal in
 * `<KEY>.draft.json`: refused if the two differ, and equally if the counter-seal
 * is gone or no longer parses.
 *
 * `admit` writes the two files from one object and `focrux edit` rewrites both,
 * so they agree unless something else wrote one of them — a text editor, a
 * script, a patch applied to the store. That difference is not an edit and is
 * not counted as one: it is a contract nobody was shown, and approving it would
 * hand the runner a scope, a criterion or an outcome that never passed through
 * the command that re-derives the level and records what changed.
 *
 * **A missing or unreadable counter-seal is refused too**, or the check would be
 * one anybody could opt out of by deleting the file they were about to edit,
 * and it would hold against a slip and against nothing else. What makes that
 * safe to require is `admission.counter_sealed_at`: the ticket's own record that
 * the pair was written. Null there means a ticket admitted before counter-seals
 * existed — nothing is required of it and nothing compared, because for such a
 * ticket a difference is the work of an earlier `focrux edit` that rewrote only
 * one file, not a hand edit, and refusing it would strand tickets in stores that
 * are already on disk. One `focrux edit` seals such a ticket from then on.
 *
 * Every field is compared, not only the three a person edits. A base commit or
 * a level that differs between the two files is the same hand edit by a
 * different route, and naming it is cheaper than the argument about whether it
 * mattered.
 *
 * Called at approval and again by `loadAdmitted`, which is what `focrux run
 * --ticket` binds an attempt through. Approval is where a person can still put
 * it right; execution is where it would otherwise stop mattering that they
 * hadn't, since an approved contract is immutable and an attempt is judged
 * against it.
 */
export function assertContractSealed(
  ticket: Ticket,
  contract: PlanContract,
  draft: DraftSnapshotFile,
): void {
  const sealedAt = ticket.admission.counter_sealed_at;
  if (sealedAt === null) return;
  const key = ticket.key;

  const problem =
    draft.kind === "absent"
      ? `${key}.draft.json is missing, and this ticket records the contract as having been ` +
        `written to it at ${sealedAt}`
      : draft.kind === "unreadable"
        ? `${key}.draft.json cannot be read: ${draft.reason}`
        : describeContractDifference(contract, draft.snapshot.contract, key);
  if (problem === null) return;

  // An unapproved ticket can still be put right, and there is exactly one
  // command that does it. An approved one cannot: the contract is immutable
  // (ADR-0016), so `focrux edit` refuses it, and the honest remedies are the
  // file the pair came from and new work.
  const remedy =
    ticket.approved_at !== null
      ? "An approved contract is immutable (ADR-0016), so this is not an edit to redo: restore " +
        `both files from version control, and if the contract should change, admit that as new work.`
      : draft.kind === "snapshot"
        ? `Change a contract the one way that records it: focrux edit ${key} ` +
          `--outcome "..." --criterion "what :: how it is proven" --path "<glob>", or focrux edit ` +
          `${key} for the editor. That rewrites both files and re-derives the level from the scope.`
        : `Restore ${key}.draft.json from version control, which also restores how the contract ` +
          "was drafted; or, if the contract as it now stands is the one you mean to approve, read " +
          `it and write the pair again from it: focrux edit ${key}.`;

  throw new UsageError(
    `${key} cannot be ${ticket.approved_at !== null ? "run" : "approved"}: ${problem}. ` +
      "Those two files are written together by admission and by `focrux edit` and by nothing " +
      "else, so a contract that has lost its counter-seal, or no longer matches it, is one " +
      `nobody was shown, and not one to start an attempt against. ${remedy}`,
  );
}

/** Where the two copies differ, named by path, or null when they do not. */
function describeContractDifference(
  sealed: PlanContract,
  drafted: PlanContract,
  key: string,
): string | null {
  const differences = contractDifferences(drafted, sealed);
  if (differences.length === 0) return null;
  return (
    `${key}.contract.json and the contract recorded beside it in ${key}.draft.json differ at ` +
    `${differences.length} field${differences.length === 1 ? "" : "s"} — ${differences.join(", ")}`
  );
}

/** The drafting transport, the reviewer's own, constrained to the draft schema. */
function draftingModel(provider: DraftProvider, modelId: string | null): ReviewModel {
  const options = {
    submitSchema: CONTRACT_DRAFT_JSON_SCHEMA,
    ...(modelId ? { modelId } : {}),
  };
  if (provider === "claude-cli") return claudeCliModel(options);
  if (provider === "codex-cli") return codexCliModel(options);
  return anthropicModel(options);
}

interface Resolved {
  outcome: string;
  criteria: AcceptanceCriterion[];
  paths: string[];
  prohibited: string[];
  criteriaSource: "typed" | "file" | "drafted";
  issue: SourceIssue | null;
  drafted: DraftResult | null;
  /** The file `--from-file` read, resolved. Null for every other source. */
  sourcePath: string | null;
  /** Keys this work follows: typed with `--depends-on`, else what the draft proposed against the board. */
  dependsOn: string[];
}

export interface AdmitInput {
  args: AdmitArgs;
  streams: Streams;
  cwd: string;
  now?: Date;
  /** The drafting model, for tests. Otherwise built from `--provider`. */
  model?: ReviewModel;
  /** The issue reader, for tests. Otherwise `gh issue view`. */
  fetchIssue?: (reference: string) => Promise<GitHubIssue>;
}

/**
 * The issue the draft is made from, from whichever source was named.
 *
 * One function so there is one shape and one call afterwards: `--from-file`
 * reads external-trust text off the disk and `--from` reads it out of GitHub,
 * and past this point nothing downstream can tell — or needs to tell — which
 * of the two it was holding.
 */
function readSource(input: AdmitInput): Promise<{ issue: SourceIssue; path: string | null }> {
  const { args } = input;
  if (args.fromFile !== null) {
    // Resolved against the working directory, like every other path this
    // command takes, so `--from-file issue.md` means the one in front of you.
    // The resolved path is what travels on: it is the one that names the same
    // file when the ticket is read from another directory or another machine.
    const path = resolve(input.cwd, args.fromFile);
    return Promise.resolve({ issue: readIssueFile(path), path });
  }
  return (input.fetchIssue ?? fetchGitHubIssue)(args.from!).then((issue) => ({ issue, path: null }));
}

function typedCriteria(input: AdmitInput): AcceptanceCriterion[] {
  const { args } = input;
  const raw = args.criteriaFile
    ? [...args.criteria, ...readCriteriaFile(resolve(input.cwd, args.criteriaFile))]
    : args.criteria;
  const manual: ManualVerifier = { reviewer: args.manualReviewer, reason: args.manualReason };
  return raw.map((line, index) => parseCriterion(line, index, manual));
}

function resolveTyped(input: AdmitInput): Resolved {
  const { args } = input;
  if (!args.title) throw new UsageError("--outcome is required: one sentence, what will be true");
  const criteria = typedCriteria(input);
  if (criteria.length === 0) {
    throw new UsageError(
      "at least one --criterion is required. A ticket with no acceptance criteria has nothing " +
        "for review to judge, and admitting it would produce a contract that cannot fail",
    );
  }
  if (args.paths.length === 0) {
    throw new UsageError(
      "at least one --path is required. Scope bounds what the executor may touch and what counts " +
        "as an escape; an unbounded ticket has no scope guard at all",
    );
  }
  return {
    outcome: args.title,
    criteria,
    paths: args.paths,
    prohibited: args.prohibited,
    criteriaSource: args.criteriaFile ? "file" : "typed",
    issue: null,
    drafted: null,
    sourcePath: null,
    dependsOn: args.dependsOn,
  };
}

/**
 * The tickets in flight, as the drafter is shown them: keys it may depend on,
 * and scopes to keep clear of. Drafts awaiting approval are on it too — the
 * next ticket from the same epic follows one the person has not yet approved.
 */
function board(dir: string, leftOff: (key: string) => void): BoardEntry[] {
  const inFlight = new Set<string>(["plan_review", ...QUEUE_HOLDING_STATES]);
  return listTickets(dir)
    .filter((ticket) => inFlight.has(ticket.state))
    .flatMap((ticket) => {
      // A ticket whose contract cannot be read is stepped over, as `list`
      // steps over a ticket it cannot read: one broken record does not stop
      // every admission after it. Said, because the drafter is then told
      // that ticket is not in flight.
      let paths_allowed: readonly string[];
      try {
        paths_allowed = readContract(dir, ticket.key).scope.paths_allowed;
      } catch {
        leftOff(ticket.key);
        return [];
      }
      return [
        {
          key: ticket.key,
          state: ticket.state,
          priority: ticket.priority,
          outcome: ticket.title,
          paths_allowed,
          approved: ticket.approved_at !== null,
        },
      ];
    });
}

/** Smaller than a review's: the drafter opens a few files to name a scope, not to judge a change. */
const DRAFT_READ_LIMITS = {
  maxFiles: 8,
  maxBytesPerFile: 32 * 1024,
  maxTotalBytes: 128 * 1024,
  maxTreeEntries: 600,
};

/**
 * Draft from the issue, then let every typed flag override its part: `--outcome`
 * the outcome, any `--criterion` all the criteria, any `--path` all the globs.
 *
 * The same function for `--from` and `--from-file`, deliberately: a pasted file
 * and a fetched issue are the same external-trust text once read, and a second
 * path to the model is a second place for that to stop being true.
 */
async function resolveDrafted(input: AdmitInput): Promise<Resolved> {
  const { args, streams } = input;
  const repositoryRoot = resolve(input.cwd, args.repo);
  let issue: SourceIssue;
  let sourcePath: string | null;
  let drafted: DraftResult;
  try {
    ({ issue, path: sourcePath } = await readSource(input));
    const model = input.model ?? draftingModel(args.provider, args.model);
    streams.stderr(
      `read ${issue.reference}: ${issue.title}\ndrafting the contract with ${model.provider} ` +
        `${model.model_id}; nothing runs until you approve it\n`,
    );
    drafted = await draftContract({
      title: issue.title,
      body: issue.body,
      ...(issue.url !== undefined ? { url: issue.url } : {}),
      // Carried so a flagged line is reported at the line of the file the
      // person will open, not at an offset into the text this assembled.
      ...(issue.source_lines !== undefined ? { sourceLines: issue.source_lines } : {}),
      reference: issue.reference,
      repositoryRoot,
      repositoryId: repositoryId(repositoryRoot),
      defaultProhibited: args.prohibited,
      defaultGenerated: args.generated,
      board: board(storeDir(repositoryRoot, args.store), (key) =>
        streams.stderr(`${key} is in flight but its contract cannot be read; it is left off the board\n`),
      ),
      reader: new RepoReader(repositoryRoot, DRAFT_READ_LIMITS),
      model,
    });
  } catch (error) {
    if (error instanceof PlanningError) throw new UsageError(error.message);
    if (error instanceof ProviderError) {
      throw new UsageError(
        `the draft could not be produced (${error.kind}): ${error.message}. Admit the work by ` +
          "hand with --outcome, --criterion and --path, or try again",
      );
    }
    throw error;
  }

  const typed = typedCriteria(input);
  const criteria =
    typed.length > 0
      ? typed
      : drafted.draft.acceptance_criteria.map((criterion, index) =>
          AcceptanceCriterionSchema.parse({
            id: `ac_${index + 1}`,
            text: criterion.text,
            expected_verification: { kind: criterion.kind, assertion: criterion.assertion },
          }),
        );
  return {
    outcome: args.title ?? drafted.draft.outcome,
    criteria,
    paths: args.paths.length > 0 ? args.paths : drafted.draft.proposed_scope.paths_allowed,
    prohibited: [...new Set([...args.prohibited, ...drafted.draft.proposed_scope.paths_prohibited_extra])],
    criteriaSource: "drafted",
    issue,
    drafted,
    sourcePath,
    dependsOn: args.dependsOn.length > 0 ? args.dependsOn : drafted.draft.depends_on,
  };
}

/**
 * Synchronous for typed admission, which every test and script relies on;
 * a promise when `--from` or `--from-file` is given, because drafting calls a
 * model.
 */
export function runAdmitCommand(input: AdmitInput): number | Promise<number> {
  const started = Date.now();
  const flag = input.args.from !== null ? "--from" : input.args.fromFile !== null ? "--from-file" : null;
  if (flag !== null) {
    // D-072 licenses drafting only because a person reads the draft before it
    // binds anything. Approving in the same command would hand the runner a
    // scope nobody read, which is the ADR-0023 §4 case D-072 argued around.
    // The source makes no difference: text off the disk is external too.
    if (input.args.approve) {
      throw new UsageError(
        `${flag} drafts the contract with a model, so it cannot be approved in the same command: ` +
          "read the draft, then `focrux approve <key>`",
      );
    }
    return resolveDrafted(input).then((resolved) => admit(input, started, resolved));
  }
  return admit(input, started, resolveTyped(input));
}

const money = (micros: number, basis: string): string =>
  basis === "unavailable" ? "cost unavailable" : `$${(micros / 1_000_000).toFixed(4)}`;

const duration = (ms: number): string =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 60_000)}min`;

function admit(input: AdmitInput, started: number, resolved: Resolved): number {
  const now = input.now ?? new Date();
  const { args, streams } = input;
  const repositoryRoot = resolve(input.cwd, args.repo);
  const dir = storeDir(repositoryRoot, args.store);

  const key = nextKey(dir, args.prefix);
  const { ticket_id, plan_id } = idsFor(key, now);
  const repository_id = repositoryId(repositoryRoot);
  const base_commit = headCommit(repositoryRoot);

  const scope: Scope = {
    repository_id,
    paths_allowed: resolved.paths,
    paths_prohibited: resolved.prohibited,
    generated_paths: args.generated,
    expansion_budget_files: args.expansionBudget,
  };
  const level = chooseLevel(scope, args.level);
  const contract = assembleContract({
    identity: { plan_id, version: 1, ticket_id },
    level,
    outcome: resolved.outcome,
    criteria: resolved.criteria,
    scope,
    base: {
      base_commit,
      context_manifest_hash: contextManifestHash({ base_commit, ...scope }),
      captured_at: now.toISOString(),
    },
  });
  // Refused before anything is written: a P3 with unstated decisions cannot be
  // approved, so `--approve` must not create a ticket that then cannot be.
  if (args.approve) assertApprovable(contract, key, readJudgingPaths(dir));

  let ticket = TicketSchema.parse({
    schema_version: TICKET_SCHEMA_VERSION,
    ticket_id,
    key,
    title: resolved.outcome,
    state: "plan_review",
    priority: args.priority,
    labels: args.labels,
    depends_on: resolved.dependsOn,
    source: sourceOf(args, resolved.issue, resolved.sourcePath),
    repository_root: repositoryRoot,
    plan_id,
    plan_version: 1,
    approved_at: null,
    admitted_at: now.toISOString(),
    updated_at: now.toISOString(),
    admission: {
      elapsed_ms: Date.now() - started,
      criteria_source: resolved.criteriaSource,
      criteria_count: resolved.criteria.length,
      drafted_at: resolved.drafted ? now.toISOString() : null,
      human_elapsed_ms: null,
      edit_count: null,
      // The contract and the copy inside the draft snapshot are written from
      // one object, a few lines below, and this says so: from here on approval
      // and execution require the pair and compare it.
      counter_sealed_at: now.toISOString(),
      level_source: level.source,
      derived_level: level.derivation.level,
    },
    history: [
      {
        at: now.toISOString(),
        from: null,
        to: "plan_review",
        note: resolved.issue
          ? `admitted from ${resolved.sourcePath ?? resolved.issue.reference}, contract drafted`
          : args.source
            ? `admitted from ${args.source}`
            : "admitted",
      },
    ],
  });

  const snapshot: DraftSnapshot = {
    schema_version: 1,
    key,
    rendered_at: now.toISOString(),
    criteria_source: resolved.criteriaSource,
    contract,
    /** Nothing has been edited yet; `focrux edit` appends to this. */
    edits: [],
    draft:
      resolved.drafted && resolved.issue
        ? {
            issue: {
              reference: resolved.issue.reference,
              url: resolved.issue.url ?? null,
              /** Null for a fetched issue; the file this one was read from. */
              path: resolved.sourcePath,
              title: resolved.issue.title,
            },
            proposed: resolved.drafted.draft,
            model: resolved.drafted.model,
            unknown_roots: resolved.drafted.unknown_roots,
            // Kept beside the draft, not only printed: what the issue tried on
            // the drafter is part of what a person is approving against.
            issue_authored_attempts: resolved.drafted.issue_authored_attempts,
            issue_authored_attempts_found: resolved.drafted.issue_authored_attempts_found,
            files_read: resolved.drafted.files_read,
          }
        : null,
  };

  recordIssued(dir, key);
  writeContract(dir, ticket, contract);
  writeDraftSnapshot(dir, snapshot);
  if (args.approve) {
    const moved = transition(ticket, "ready", "contract approved at admission", now);
    ticket = TicketSchema.parse({
      ...moved,
      approved_at: now.toISOString(),
      admission: { ...moved.admission, human_elapsed_ms: 0, edit_count: 0 },
    });
  }
  const path = writeTicket(dir, ticket);

  if (args.json) {
    streams.stdout(`${JSON.stringify({ ticket, contract, draft: snapshot.draft }, null, 2)}\n`);
    return EXIT_CODES.approve;
  }

  streams.stdout(`${key}  ${ticket.title}\n`);
  streams.stderr(renderAdmitted({ input, key, ticket, contract, level, resolved, path }));
  return EXIT_CODES.approve;
}

/** The human rendering: outcome, criteria, scope and level, then the next step. */
function renderAdmitted(args: {
  input: AdmitInput;
  key: string;
  ticket: Ticket;
  contract: PlanContract;
  level: LevelChoice;
  resolved: Resolved;
  path: string;
}): string {
  const { key, ticket, contract, level, resolved } = args;
  const drafted = resolved.drafted;
  const criteria = resolved.criteria
    .map(
      (criterion) =>
        `    ${criterion.id}  ${criterion.text}\n` +
        `          proven by (${criterion.expected_verification.kind}): ` +
        `${criterion.expected_verification.assertion}\n`,
    )
    .join("");
  const levelLine =
    `${contract.level} ` +
    (level.source === "raised"
      ? `(raised from ${level.derivation.level}: ${level.derivation.reasons.join("; ")})`
      : `(derived: ${level.derivation.reasons.join("; ")})`);
  const unknown =
    drafted && drafted.unknown_roots.length > 0
      ? `\n            not in the tree today: ${drafted.unknown_roots.join(", ")}`
      : "";
  // Printed whether the model mentioned them or not: the issue is external
  // text, and what it tried on the drafter is something the person approving
  // reads before they decide, not after.
  //
  // The headline number is what the text held, not what this listed. They part
  // company when a body carries more attempts than the listing takes, and that
  // body — one written to bury the report in its own noise — is precisely the
  // one where a number that quietly meant "twenty, or more" would mislead.
  const found = drafted?.issue_authored_attempts_found ?? 0;
  const listed = drafted?.issue_authored_attempts ?? [];
  const attempts =
    found > 0
      ? `  flagged   ${found} issue-authored attempt${found === 1 ? "" : "s"} — read as data, ` +
        `not followed\n` +
        listed
          .map(
            (attempt) =>
              `            line ${attempt.line} ${attempt.kind}: ${attempt.what}\n` +
              `              "${attempt.quote}"\n`,
          )
          .join("") +
        (found > listed.length
          ? `            and ${found - listed.length} more, not listed: only the first ` +
            `${listed.length} are shown\n`
          : "")
      : "";
  const head = drafted
    ? `\ndrafted ${key} (${ticket.state}) from ` +
      `${resolved.sourcePath ?? resolved.issue?.reference} in ` +
      `${duration(ticket.admission.elapsed_ms)} — ${drafted.model.provider} ` +
      `${drafted.model.model_id}, ${money(drafted.model.cost_micros, drafted.model.cost_basis)}\n`
    : `\nadmitted ${key} (${ticket.state}) in ${ticket.admission.elapsed_ms}ms\n`;
  const next = ticket.approved_at
    ? `\nApproved. The contract is immutable from here.\n  focrux run --ticket ${key}\n`
    : drafted
      ? `\nThe model drafted this; nothing runs until you approve it. Edit anything, then approve:\n` +
        `  focrux edit ${key}\n  focrux approve ${key}\n`
      : `\nRead the contract, then approve it:\n  focrux edit ${key}\n  focrux approve ${key}\n`;
  return (
    head +
    `  contract  ${contract.plan_id} v1, ${levelLine}, ${resolved.criteria.length} criteria\n` +
    `  base      ${contract.base.base_commit.slice(0, 12)}\n` +
    `  outcome   ${contract.outcome}\n` +
    `  criteria\n${criteria}` +
    `  scope     ${contract.scope.paths_allowed.join(", ")}` +
    (drafted && args.input.args.paths.length === 0 ? "  (proposed by the model)" : "") +
    unknown +
    "\n" +
    (ticket.depends_on.length > 0 ? `  after     ${ticket.depends_on.join(", ")}\n` : "") +
    (drafted ? `  rationale ${drafted.draft.rationale}\n` : "") +
    attempts +
    `  stored    ${relative(args.input.cwd, args.path)}` +
    (drafted ? " (draft beside it)\n" : "\n") +
    next +
    "\nAdmitting takes ownership of this one piece of work. Nothing else moved.\n"
  );
}

/**
 * What `focrux edit` recorded changing, across every edit, deduplicated.
 *
 * The fields a person had to touch, not the number of times they touched them:
 * two passes over the outcome is one field the rendering got wrong, and
 * counting it twice would make the friction instrument (D-003) a measure of how
 * often the command was run. For a ticket edited once — every ticket in the
 * record so far — this is the number `approve` used to compute by diffing the
 * two files, from the same `contractEditCount` and in the same words.
 */
export function recordedEdits(snapshot: DraftSnapshot): { count: number; changes: string[] } {
  const changes = [...new Set(snapshot.edits.flatMap((edit) => edit.changes))];
  return { count: changes.length, changes };
}

export function runApproveCommand(input: {
  argv: string[];
  streams: Streams;
  cwd: string;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const [key, ...rest] = input.argv;
  if (!key || key.startsWith("--")) throw new UsageError("approve requires a ticket key, e.g. FCX-1");
  const args = parseListArgs(rest);
  const dir = storeDir(resolve(input.cwd, args.repo), args.store);

  const existing = readTicket(dir, key);
  if (existing.approved_at !== null) {
    input.streams.stderr(`${key} was already approved at ${existing.approved_at}\n`);
    return EXIT_CODES.approve;
  }
  const contract = readContract(dir, key);
  assertContractMatches(existing, contract);
  const draft = readDraftSnapshotFile(dir, key);
  // Before the scope is judged and before anything is written: a pair of files
  // that disagree is a contract with no agreed content to judge.
  assertContractSealed(existing, contract, draft);
  assertApprovable(contract, key, readJudgingPaths(dir));

  // D-003's instrument, written here because this is the moment it ends: the
  // person's time from first seeing the contract, and how much of it they
  // changed before signing it.
  //
  // For a counter-sealed ticket the edits are the ones `focrux edit` recorded as
  // it applied them: with the two contracts held in step by the check above, a
  // difference between the files is never one of them and is never reported as
  // one. For a ticket with no counter-seal the difference is all there is, and
  // it is what the version that wrote that store measured — the two numbers
  // agree for every ticket either version could produce.
  const snapshot = draft.kind === "snapshot" ? draft.snapshot : null;
  const edits = snapshot
    ? existing.admission.counter_sealed_at === null
      ? contractEditCount(snapshot.contract, contract)
      : recordedEdits(snapshot)
    : null;
  const human_elapsed_ms = Math.max(0, now.getTime() - Date.parse(existing.admitted_at));
  const moved = transition(existing, "ready", "contract approved", now);
  const approved = TicketSchema.parse({
    ...moved,
    approved_at: now.toISOString(),
    admission: {
      ...moved.admission,
      human_elapsed_ms,
      edit_count: edits ? edits.count : null,
    },
  });
  writeTicket(dir, approved);
  input.streams.stderr(
    `${key} approved. ${contract.plan_id} v${contract.version} is immutable from here.\n` +
      `  ${duration(human_elapsed_ms)} from first rendering to approval, ` +
      (edits
        ? `${edits.count} edit${edits.count === 1 ? "" : "s"}` +
          (edits.count > 0 ? ` (${edits.changes.join(", ")})` : "")
        : "edits unknown (no draft snapshot)") +
      `\n  focrux run --ticket ${key}\n`,
  );
  return EXIT_CODES.approve;
}

const STATE_WIDTH = 19;

/** Said on stderr in both modes: a pipe reading stdout never sees it. */
const EMPTY_STORE_HINT =
  "\nAdmit the thing you are about to do. Your backlog stays where it is.\n" +
  '  focrux admit --outcome "..." --criterion "... :: ..." --path "src/**"\n';

/** Bumped when a field of the document below changes meaning or leaves it. */
export const LIST_JSON_SCHEMA_VERSION = 1;

/**
 * What `focrux list --json` writes, and the whole of what it writes.
 *
 * The shape is stated in [docs/design/list-json.md](../../../docs/design/list-json.md)
 * and parsed here on the way out, so the document and the emitted bytes cannot
 * drift apart without one of them failing.
 *
 * **An object, not the bare array this used to print.** A bare array leaves a
 * script no room to be told anything about the listing it is holding — which
 * store it came from, whether `--all` was in force, how many tickets the filter
 * hid — and every one of those is a fact a caller otherwise has to guess from
 * the argv it passed. Adding them later to an array would have meant changing
 * the top-level type, which is the one change no consumer survives.
 *
 * **A ticket entry is the stored ticket, verbatim.** Not a projection of the
 * five columns the table draws: the table is a rendering for a person at 80
 * columns and a script is not reading at 80 columns. Verbatim also means there
 * is no second field list to keep in step with `TicketSchema`, and no way for
 * the two renderings to disagree about a ticket (decisions 3 and 4 in
 * docs/design/list-json.md). `state` is the stored lifecycle state, the
 * same string the `STATE` column prints, and `history` is every transition the
 * ticket has recorded, in order and uncollapsed.
 */
export const ListJsonSchema = z.strictObject({
  schema_version: z.literal(LIST_JSON_SCHEMA_VERSION),
  /** The store the listing was read from, absolute. */
  store: z.string().min(1),
  /** The filter this listing was taken under, so a caller need not infer it. */
  filter: z.strictObject({ all: z.boolean() }),
  /** `shown` is `tickets.length`; `total` is the store before the filter. */
  counts: z.strictObject({
    shown: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  /** Every ticket the table would print, in the order it would print them. */
  tickets: z.array(TicketSchema),
});
export type ListJson = z.infer<typeof ListJsonSchema>;

/** The document for one listing, parsed rather than assembled and trusted. */
export function listJson(input: {
  store: string;
  all: boolean;
  shown: readonly Ticket[];
  total: number;
}): ListJson {
  return ListJsonSchema.parse({
    schema_version: LIST_JSON_SCHEMA_VERSION,
    store: input.store,
    filter: { all: input.all },
    counts: { shown: input.shown.length, total: input.total },
    tickets: input.shown,
  });
}

export function runListCommand(input: { args: ListArgs; streams: Streams; cwd: string }): number {
  const { args, streams } = input;
  const dir = storeDir(resolve(input.cwd, args.repo), args.store);
  const all = listTickets(dir);
  const shown = args.all ? all : all.filter(isActive);

  // Before every other branch, including the empty-store one: in this mode
  // stdout carries one JSON document and nothing else, and an empty store is a
  // listing of no tickets rather than an occasion for advice. The advice is
  // still worth giving, so it goes to stderr where a pipe does not see it.
  if (args.json) {
    const document = listJson({ store: dir, all: args.all, shown, total: all.length });
    streams.stdout(`${JSON.stringify(document, null, 2)}\n`);
    if (all.length === 0) streams.stderr(EMPTY_STORE_HINT);
    return EXIT_CODES.approve;
  }

  if (all.length === 0) {
    streams.stdout("No admitted work.\n");
    streams.stderr(EMPTY_STORE_HINT);
    return EXIT_CODES.approve;
  }

  const rows = shown.map((ticket) => ({
    key: ticket.key,
    state: ticket.state,
    title: ticket.title,
    // Kind and all: an absolute path and a Jira key are both "a string in the
    // source column" and a person should not have to tell them apart by eye.
    source: ticketSourceLabel(ticket.source) ?? "—",
    priority: ticket.priority,
    // Why a blocked ticket waits, and a re-level that did not level an open
    // branch, from the queue's own record — the one line a person needs
    // before they go looking for the ticket ahead.
    waits: describeScheduling(ticket.scheduling, ticket.state),
  }));
  const keyWidth = Math.max(6, ...rows.map((row) => row.key.length));

  streams.stdout(
    `${"TICKET".padEnd(keyWidth)}  ${"STATE".padEnd(STATE_WIDTH)}  OUTCOME\n` +
      rows
        .map(
          (row) =>
            `${row.key.padEnd(keyWidth)}  ${row.state.padEnd(STATE_WIDTH)}  ${row.title}\n` +
            `${" ".repeat(keyWidth)}  ${" ".repeat(STATE_WIDTH)}  ${row.priority}${
              row.source === "—" ? "" : ` · ${row.source}`
            }${row.waits === null ? "" : ` · ${row.waits}`}\n`,
        )
        .join(""),
  );
  streams.stderr(
    `\n${shown.length} of ${all.length} shown${args.all ? "" : " (active only; --all for the rest)"}\n`,
  );
  return EXIT_CODES.approve;
}

export { TicketStoreError };

/**
 * The states a completed run passed through, derived from what the result
 * proves rather than from progress prose.
 *
 * Each step is claimed only where the structured record shows it happened: a
 * workspace exists, an attempt was recorded, checks ran, a review was produced.
 * Parsing the progress lines would have been easier and would have made a
 * ticket's history a function of log wording.
 */
export function statesObserved(result: {
  rounds: ReadonlyArray<{ checks: readonly unknown[]; review: unknown }>;
  outcome: string;
}): Array<{ to: Parameters<typeof transition>[1]; note: string }> {
  const path: Array<{ to: Parameters<typeof transition>[1]; note: string }> = [
    { to: "provisioning", note: "worktree provisioned and materialized" },
  ];
  const last = result.rounds[result.rounds.length - 1];
  if (result.rounds.length > 0) {
    path.push({
      to: "executing",
      note: `${result.rounds.length} attempt${result.rounds.length === 1 ? "" : "s"} executed`,
    });
    // The verification stage is claimed whenever an attempt ran, including when
    // it had nothing to run. Zero checks is a fact about the repository's
    // configuration, not a stage that was skipped — and gating this on
    // `checks.length > 0` stranded the ticket in `executing` on any repository
    // with no pinned checks, because `executing -> independent_review` has no
    // row and the walk below then had nowhere legal to go.
    path.push({
      to: "verifying",
      note:
        last && last.checks.length > 0
          ? `${last.checks.length} deterministic checks ran`
          : "no deterministic checks are configured for this repository",
    });
  }
  // Round 0 carries the one independent review; a remediation round carries a
  // verification of that review's findings, not a second review (D-061). So
  // the stage is claimed when any round was reviewed, or a ticket that was
  // approved after remediation has no legal path to pr_open and strands.
  if (result.rounds.some((round) => round.review)) {
    path.push({ to: "independent_review", note: "reviewed independently" });
  }

  switch (result.outcome) {
    case "approved":
      path.push({ to: "pr_open", note: "approved; a human merges it" });
      break;
    // SCP-194: `remediation_stalled` joins these three. A round closed none of
    // the findings it was given; the change set is on the branch and the open
    // findings are named, so a person picks it up from the state a
    // `changes_requested` ticket is already in.
    case "changes_requested":
    case "escalated":
    case "remediation_exhausted":
    case "remediation_stalled":
      path.push({ to: "changes_requested", note: `the gate closed: ${result.outcome}` });
      break;
    default:
      path.push({
        to: "failed",
        note:
          result.outcome === "review_failed"
            ? "the review did not complete: the provider failed, or every verdict it returned " +
              "was one the plan could not accept — not the change (retry)"
            : result.outcome === "base_conflict"
              ? "the branch cannot reach the base it would be merged into and the round given " +
                "the conflict did not resolve it — not the change (a re-run merges " +
                "the base up again)"
              : `the attempt did not complete: ${result.outcome}`,
      });
  }
  return path;
}

/**
 * The refusal `applyObservedPath` raises when the evidence points at a state the
 * transition table cannot reach from where the walk ended.
 *
 * A distinct type rather than a bare `Error` because a caller has to tell it
 * from a corrupt ticket: the refusal is a fact about the evidence and is worth
 * printing as a reason, while a ticket that no longer validates is a fault. Both
 * abort the write; only one of them is something a person can act on.
 */
export class UnreachableStateError extends Error {
  readonly from: Ticket["state"];
  readonly to: Ticket["state"];

  constructor(from: Ticket["state"], to: Ticket["state"]) {
    // Wording preserved from the bare `Error` this replaced: a message that
    // drifts from the record of the run that produced it is the contradiction
    // class this repository treats as a defect.
    super(
      `the run ended ${to} and the ticket is ${from}, which has no row to it. ` +
        "Refusing rather than inventing the states in between: a fabricated history is worse than " +
        "an unrecorded one",
    );
    this.name = "UnreachableStateError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Walk a ticket along an observed path, skipping any step the state machine has
 * no row for. A run that terminated before executing has no `executing` step to
 * record, and inventing one to keep the walk tidy would be a lie in the history.
 *
 * **The terminal step is not optional.** Skipping an intermediate stage is
 * honest — it did not happen. Skipping the last one leaves the ticket claiming
 * a state the run has already left, which is how a completed run ended with a
 * ticket saying `executing` and a pull request open. If the observed path
 * cannot reach the terminal state, the ticket is moved there through whatever
 * legal route exists and the detour is written into the history rather than
 * hidden.
 */
export function applyObservedPath(
  ticket: Ticket,
  path: ReadonlyArray<{ to: Parameters<typeof transition>[1]; note: string }>,
  at: Date,
): Ticket {
  let current = ticket;
  for (const step of path) {
    try {
      current = transition(current, step.to, step.note, at);
    } catch (error) {
      // A missing row is expected. Anything else — a ticket that no longer
      // validates — is a real failure and must not be swallowed as one.
      if (!(error instanceof IllegalTransitionError)) throw error;
    }
  }

  const terminal = path[path.length - 1];
  if (!terminal || current.state === terminal.to) return current;

  // The terminal state could not be reached from where the observed steps left
  // the ticket. **This is refused rather than routed around.** Walking the
  // ticket through intermediate states it was never in would write a history
  // that reads as observation, which is the failure this function's own comment
  // warns about — and it is worse than a loud stop, because a wrong history
  // outlives the run that produced it.
  throw new UnreachableStateError(current.state, terminal.to);
}

/** Load an admitted ticket and its contract, for `focrux run --ticket`. */
export function loadAdmitted(
  cwd: string,
  repo: string,
  store: string | null,
  key: string,
): { dir: string; ticket: Ticket; contract: PlanContract } {
  const dir = storeDir(resolve(cwd, repo), store);
  const ticket = readTicket(dir, key);
  if (ticket.approved_at === null) {
    throw new UsageError(
      `${key} is ${ticket.state}: its contract has not been approved, and execution binds to an ` +
        `approved contract. Read it, then: focrux approve ${key}`,
    );
  }
  const contract = readContract(dir, key);
  assertContractMatches(ticket, contract);
  // The counter-seal again, at the other end: approval checked the pair, and
  // nothing rewrites either file afterwards, so a contract that has drifted
  // from it since has drifted after somebody signed it. This is the moment it
  // matters most — the attempt binds to this contract and review judges the
  // work against it — and it is the moment no person is looking.
  assertContractSealed(ticket, contract, readDraftSnapshotFile(dir, key));
  return { dir, ticket, contract };
}

export { readTicket, storeDir, writeTicket };
