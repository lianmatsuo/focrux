import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { branchName, recordedBranch } from "@focrux/workspace";
import {
  DEFAULT_LIMITS,
  LimitsTableSchema,
  MaterializationManifestSchema,
  PlanContractSchema,
  ReviewArtifactSchema,
  RunBundleSchema,
  TicketSchema,
} from "@focrux/contracts";
import type { Ticket } from "@focrux/contracts";
import {
  DraftSchema,
  EditingSessionSchema,
  HELP_LINKS,
  ManifestEditorSchema,
  RequestSchema,
  SettingsSchema,
  TaskModelsSchema,
} from "../shared/protocol.js";
import type {
  Detail,
  Change,
  ChangeInput,
  Draft,
  Job,
  PowerState,
  Provider,
  ReplyMap,
  Repository,
  Request,
  Snapshot,
  TaskSummary,
  UsageReport,
} from "../shared/protocol.js";
import { childEnvironment, redact, runProcess } from "./process.js";
import type { ProcessOptions, ProcessResult } from "./process.js";
import { archiveCsv, archiveRows, isArchived } from "../shared/archive.js";
import { discoverModels } from "./model-catalog.js";
import {
  ContractEditing,
  type EditingOwner,
} from "../shared/contract-editing.js";
import { WorkspaceReads } from "./workspace-reads.js";
import { runnerProgress } from "../shared/runner-progress.js";
import {
  currentMonth,
  isCeilingStop,
  ledgerFor,
  listBundles,
  readAttempts,
  readObject,
  summariseTicket,
  type StoredAttempt,
} from "./records.js";
import { codexUsage } from "./usage-probe.js";

const RepoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  path: z.string(),
});
const JobSchema = z.object({
  id: z.string().uuid(),
  repoId: z.string().uuid(),
  key: z.string().nullable(),
  kind: z.string(),
  label: z.string(),
  state: z.enum([
    "running",
    "stopping",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  log: z.string(),
  error: z.string().nullable(),
  resultKey: z.string().nullable(),
  result: z.unknown(),
  editing: z
    .object({ sessionId: z.string().uuid(), operationId: z.string().uuid() })
    .optional(),
});
const StateSchema = z.object({
  version: z.literal(1),
  settings: SettingsSchema,
  repositories: z.array(RepoSchema),
  jobs: z.array(JobSchema),
  titles: z.record(z.string(), z.string()).default({}),
  taskModels: z.record(z.string(), TaskModelsSchema).default({}),
  /** Completed tickets filed away from Home by hand (S4), as `repoId:key`. */
  archived: z.array(z.string()).default([]),
  /** Whether the tickets already finished before this preference existed have been filed. */
  archivedSeeded: z.boolean().default(false),
  editingSessions: z.array(EditingSessionSchema).default([]),
});
type State = z.infer<typeof StateSchema>;
const ListSchema = z.object({ tickets: z.array(TicketSchema) });
const CheckSchema = z
  .object({
    name: z.string().optional(),
    check_id: z.string().optional(),
    status: z.string(),
    summary: z.string().optional(),
    detail: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    output: z.unknown().optional(),
  })
  .passthrough();
const ReportSchema = z
  .object({
    attempts: z.array(
      z
        .object({
          attempt_id: z.string(),
          run: z.number(),
          round: z.number(),
          started_at: z.string(),
          outcome: z.string(),
          termination: z
            .object({ reason: z.string(), detail: z.string() })
            .passthrough(),
          agent: z.object({ model: z.string() }).passthrough(),
          cost: z.object({
            micros: z.number().nullable(),
            basis: z.string(),
            partial: z.boolean(),
          }),
          ceilings: z.array(
            z.object({
              resource: z.string(),
              used: z.number().nullable(),
              ceiling: z.number(),
              hit: z.boolean(),
            }),
          ),
          review: ReviewArtifactSchema.nullable(),
          review_decision: z.string().nullable(),
          changed_files: z
            .array(
              z.object({
                path: z.string(),
                change_kind: z.string(),
                additions: z.number().nullable(),
                deletions: z.number().nullable(),
              }),
            )
            .nullable(),
          checks: z.array(CheckSchema).nullable(),
          verification: z.unknown(),
          bundles: z.array(RunBundleSchema),
        })
        .passthrough(),
    ),
    total_cost: z
      .object({
        micros: z.number(),
        partial: z.number(),
        unavailable: z.number(),
      })
      .passthrough(),
    verdicts: z.array(z.unknown()),
  })
  .passthrough();

export interface HostIO {
  chooseDirectory(): Promise<string | null>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  saveFile(name: string, content: string): Promise<string | null>;
  notify(title: string, body: string, options?: { silent: boolean }): void;
  /** AFK mode (S6F): keep the machine awake while a run is live. */
  holdSleep?(hold: boolean, displaySleep: boolean): void;
  onBattery?(): boolean;
  applyTheme?(theme: "light" | "dark" | "system"): void;
  /** Runs a fixed sign-in command in the person's own terminal; absent where the host has no terminal to open. */
  openTerminal?(command: readonly string[]): Promise<void>;
}
export const LOGIN_COMMANDS = {
  claude: ["claude", "auth", "login"],
  codex: ["codex", "login"],
} as const;
export interface ServiceOptions {
  dataDirectory: string;
  cliPath: string;
  nodeBinary: string;
  electronNode?: boolean;
  version: string;
  io: HostIO;
  changed: (change: Change) => void;
  process?: typeof runProcess;
  /** The provider's own account of its plan windows; injected by tests. */
  usageProbe?: typeof codexUsage;
}

/** A capability registry: renderer requests carry repository ids, never command or filesystem targets. */
export class DesktopService {
  private readonly options: ServiceOptions;
  private readonly execute: typeof runProcess;
  private readonly statePath: string;
  private state: State;
  private readonly editing: ContractEditing;
  private readonly reads = new WorkspaceReads();
  private sequence = 0;
  private active: {
    id: string;
    controller: AbortController;
    done: Promise<void>;
  } | null = null;
  private lastSave = 0;

  constructor(options: ServiceOptions) {
    this.options = options;
    this.execute = options.process ?? runProcess;
    mkdirSync(options.dataDirectory, { recursive: true, mode: 0o700 });
    this.statePath = join(options.dataDirectory, "workspace.json");
    const stored = existsSync(this.statePath)
      ? z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(readFileSync(this.statePath, "utf8")))
      : null;
    this.state = stored
      ? StateSchema.parse(stored)
      : {
          version: 1,
          settings: SettingsSchema.parse({}),
          repositories: [],
          jobs: [],
          titles: {},
          taskModels: {},
          archived: [],
          archivedSeeded: true,
          editingSessions: [],
        };
    // A profile from before the four notification moments keeps what its one switch said.
    const legacy = z
      .looseObject({
        notifications: z.boolean().optional(),
        notifyOn: z.unknown().optional(),
      })
      .safeParse(stored?.["settings"] ?? {});
    if (
      legacy.success &&
      legacy.data.notifyOn === undefined &&
      legacy.data.notifications === false
    )
      this.state.settings.notifyOn = {
        decision: false,
        review: false,
        ceiling: false,
        stage: false,
      };
    for (const job of this.state.jobs)
      if (job.state === "running" || job.state === "stopping") {
        job.state = "interrupted";
        job.error =
          "Focrux closed before the command reported an outcome. Refresh the ticket from its CLI records before starting again.";
        job.endedAt = new Date().toISOString();
      }
    this.editing = new ContractEditing({
      records: () => this.state.editingSessions,
      persist: (records) => {
        const previous = this.state.editingSessions;
        this.state.editingSessions = records;
        try {
          this.save();
        } catch (error) {
          this.state.editingSessions = previous;
          throw error;
        }
        for (const record of records)
          if (previous.find((entry) => entry.id === record.id) !== record)
            this.changed(false, { kind: "editing", sessionId: record.id });
      },
      repository: (id) => {
        this.repository(id);
      },
      defaults: (repoId, key) =>
        TaskModelsSchema.strip().parse(
          this.state.taskModels[repoId + ":" + key] ?? this.state.settings,
        ),
      detail: (repoId, key) => this.detail(repoId, key),
      start: async (request, owner) =>
        (await this.dispatch(request, owner)) as Job,
      stop: async (jobId) => {
        await this.dispatch({ kind: "cancel", jobId });
      },
      id: randomUUID,
    });
    this.editing.recover();
    this.save();
    this.options.io.applyTheme?.(this.state.settings.theme);
  }

  private save(): void {
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, this.statePath);
    this.lastSave = Date.now();
  }
  private changed(
    persist = true,
    change: ChangeInput = { kind: "records", repoId: null, key: null },
  ): void {
    if (change.kind === "records")
      this.reads.invalidate(change.repoId ?? "all");
    if (change.kind === "repositories" || change.kind === "preferences")
      this.reads.invalidate("all");
    if (persist) this.save();
    this.options.changed({ ...change, sequence: ++this.sequence });
  }
  private preferencesChanged(): void {
    this.changed(true, {
      kind: "preferences",
      settings: this.state.settings,
      titles: this.state.titles,
      taskModels: this.state.taskModels,
      archived: this.state.archived,
    });
  }
  private repository(id: string): z.infer<typeof RepoSchema> {
    const repo = this.state.repositories.find((entry) => entry.id === id);
    if (!repo)
      throw new Error(
        "This repository is no longer connected. Choose it again in Settings.",
      );
    if (realpathSync(repo.path) !== repo.path)
      throw new Error(
        "The repository path changed. Reconnect the repository before continuing.",
      );
    this.safePath(repo, ".focrux");
    return repo;
  }
  private safePath(
    repo: z.infer<typeof RepoSchema>,
    ...parts: string[]
  ): string {
    const path = resolve(repo.path, ...parts),
      fragment = relative(repo.path, path);
    if (
      isAbsolute(fragment) ||
      fragment === ".." ||
      fragment.startsWith(`..${sep}`)
    )
      throw new Error("Path is outside the selected repository.");
    let cursor = repo.path;
    for (const part of fragment.split(sep)) {
      cursor = join(cursor, part);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
        throw new Error(
          "Focrux refuses a symlink in the ticket store. Use a repository-owned .focrux directory.",
        );
    }
    return path;
  }
  private cli(
    args: string[],
    repo: z.infer<typeof RepoSchema>,
    options: Partial<ProcessOptions> = {},
  ): Promise<ProcessResult> {
    const env = childEnvironment();
    if (this.options.electronNode) env.ELECTRON_RUN_AS_NODE = "1";
    return this.execute(
      this.options.nodeBinary,
      [this.options.cliPath, ...args, "--repo", repo.path],
      { ...options, cwd: repo.path, env },
    );
  }
  private requireSuccess(result: ProcessResult): string {
    if (result.code !== 0)
      throw new Error(
        result.cancelled
          ? "Command stopped. Refresh the ticket to read its recorded outcome."
          : result.stderr.trim() || `CLI exited with code ${result.code}.`,
      );
    return result.stdout;
  }
  private async metadata(
    repo: z.infer<typeof RepoSchema>,
  ): Promise<Repository> {
    return this.reads.read("metadata:" + repo.id, repo.id, () =>
      this.readMetadata(repo),
    );
  }
  private async readMetadata(
    repo: z.infer<typeof RepoSchema>,
  ): Promise<Repository> {
    try {
      this.repository(repo.id);
      const result = await this.execute(
        "git",
        ["--no-optional-locks", "status", "--porcelain=v1", "--branch"],
        { cwd: repo.path },
      );
      const status = this.requireSuccess(result).trimEnd().split("\n");
      const head = this.requireSuccess(
        await this.execute("git", ["rev-parse", "HEAD"], { cwd: repo.path }),
      ).trim();
      const configPath = this.safePath(repo, ".focrux", "config.json");
      const config = existsSync(configPath)
        ? z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(readFileSync(configPath, "utf8")))
        : {};
      const manifest = MaterializationManifestSchema.safeParse(
        config["materialization_manifest"],
      );
      const protectedPaths = z
        .array(z.string())
        .safeParse(config["protected_paths"]);
      return {
        ...repo,
        head,
        branch:
          (status[0] ?? "").replace(/^## /, "").split("...")[0] ?? "detached",
        dirty: status.length > 1,
        configured: existsSync(this.safePath(repo, ".focrux", "config.json")),
        error: null,
        ...(manifest.success
          ? {
              testCommand: manifest.data.verify.command.join(" "),
              manifestCount: manifest.data.entries.length,
            }
          : {}),
        ...(protectedPaths.success
          ? { prohibitedPaths: protectedPaths.data }
          : {}),
      };
    } catch (error) {
      return {
        ...repo,
        branch: "Unavailable",
        head: "",
        dirty: false,
        configured: false,
        error: redact(String(error)),
      };
    }
  }
  async registerRepository(path: string): Promise<Repository> {
    const canonical = realpathSync(path);
    const root = this.requireSuccess(
      await this.execute("git", ["rev-parse", "--show-toplevel"], {
        cwd: canonical,
      }),
    ).trim();
    if (realpathSync(root) !== canonical)
      throw new Error("Choose the root folder of the Git checkout.");
    const existing = this.state.repositories.find(
      (repo) => repo.path === canonical,
    );
    if (existing) return this.metadata(existing);
    const repo = {
      id: randomUUID(),
      name: basename(canonical),
      path: canonical,
    };
    this.safePath(repo, ".focrux");
    this.state.repositories.push(repo);
    this.changed(true, { kind: "repositories" });
    return this.metadata(repo);
  }
  async snapshot(): Promise<Snapshot> {
    return this.reads.read("snapshot", "snapshot", async () => {
      const records = await Promise.all(
        this.state.repositories.map((repo) => this.repositorySnapshot(repo.id)),
      );
      const tasks = records.flatMap((entry) => entry.tasks);
      if (
        !this.state.archivedSeeded &&
        !records.some((entry) => entry.errors.length)
      ) {
        // The first complete listing after this preference arrived: what had already finished is already filed.
        this.state.archived = [
          ...new Set([
            ...this.state.archived,
            ...tasks
              .filter((row) => isArchived(row.ticket.state))
              .map((row) => row.repoId + ":" + row.ticket.key),
          ]),
        ];
        this.state.archivedSeeded = true;
        this.save();
      }
      return {
        mode: "desktop" as const,
        version: this.options.version,
        settings: this.state.settings,
        repositories: records.map((entry) => entry.repository),
        tasks,
        jobs: this.state.jobs as Job[],
        errors: records.flatMap((entry) => entry.errors),
        titles: this.state.titles,
        taskModels: this.state.taskModels,
        sequence: this.sequence,
        archived: this.state.archived,
        power: this.power,
        repositoryErrors: Object.fromEntries(
          records.map((entry) => [entry.repository.id, entry.errors]),
        ),
      };
    });
  }
  private list(repo: z.infer<typeof RepoSchema>) {
    return this.reads.read("list:" + repo.id, repo.id, async () =>
      ListSchema.parse(
        JSON.parse(
          this.requireSuccess(
            await this.cli(["list", "--all", "--json"], repo),
          ),
        ),
      ),
    );
  }
  private async repositorySnapshot(
    repoId: string,
  ): Promise<ReplyMap["repositorySnapshot"]> {
    const repo = this.repository(repoId);
    return this.reads.read("repository:" + repoId, repoId, async () => {
      const [metadata, listing] = await Promise.allSettled([
        this.metadata(repo),
        this.list(repo),
      ]);
      if (metadata.status === "rejected") throw metadata.reason;
      const repository = metadata.value;
      try {
        if (repository.error) throw new Error(repository.error);
        if (listing.status === "rejected") throw listing.reason;
        const list = listing.value;
        return {
          repository,
          tasks: list.tickets.map((ticket) => ({
            repoId,
            repository: repo.name,
            ticket,
          })),
          errors: [],
        };
      } catch (error) {
        return {
          repository,
          tasks: [],
          errors: [`${repo.name}: ${redact(String(error))}`],
        };
      }
    });
  }
  private readContract(
    repo: z.infer<typeof RepoSchema>,
    key: string,
  ): { contract: Detail["contract"]; digest: string } {
    const raw = readFileSync(
      this.safePath(repo, ".focrux", "tickets", `${key}.contract.json`),
      "utf8",
    );
    return {
      contract: PlanContractSchema.parse(JSON.parse(raw)),
      digest: createHash("sha256").update(raw).digest("hex"),
    };
  }
  private assertDigest(
    repo: z.infer<typeof RepoSchema>,
    key: string,
    digest: string,
  ): void {
    if (this.readContract(repo, key).digest !== digest)
      throw new Error(
        "The contract changed since you opened it. Refresh and review the latest version before approving or editing.",
      );
  }
  private limits(
    repo: z.infer<typeof RepoSchema>,
  ): z.infer<typeof LimitsTableSchema> {
    const path = this.safePath(repo, ".focrux", "config.json");
    const record = existsSync(path)
      ? z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(readFileSync(path, "utf8")))
      : {};
    const current = LimitsTableSchema.parse(
      record["limits"] ?? { organisation: "local" },
    );
    const settings = this.state.settings;
    return {
      ...current,
      limits: {
        ...current.limits,
        attempt_wall_clock_ms: Math.min(
          current.limits["attempt_wall_clock_ms"] ??
            DEFAULT_LIMITS.attempt_wall_clock_ms,
          settings.minutes * 60_000,
        ),
        // Nothing defaults a command ceiling (D-096), so the shell's own
        // setting is the one an attempt started here gets, and a repository
        // that set a lower one keeps it.
        attempt_commands: Math.min(
          current.limits["attempt_commands"] ?? settings.commands,
          settings.commands,
        ),
        ticket_cost_micros: Math.min(
          current.limits["ticket_cost_micros"] ??
            DEFAULT_LIMITS.ticket_cost_micros,
          Math.round(settings.ticketDollars * 1_000_000),
        ),
      },
    };
  }
  async detail(repoId: string, key: string): Promise<Detail> {
    return this.reads.read("detail:" + repoId + ":" + key, repoId, () =>
      this.readDetail(repoId, key),
    );
  }
  private async readDetail(repoId: string, key: string): Promise<Detail> {
    const repo = this.repository(repoId);
    const list = await this.list(repo);
    const ticket = list.tickets.find((entry) => entry.key === key);
    if (!ticket)
      throw new Error(
        "This task is no longer in the repository's ticket store.",
      );
    const report = ReportSchema.parse(
      JSON.parse(
        this.requireSuccess(await this.cli(["inspect", key, "--json"], repo)),
      ),
    );
    const principlesPath = this.safePath(repo, ".focrux", "principles.md");
    const limits = this.limits(repo).limits;
    return {
      ticket,
      ...this.readContract(repo, key),
      attempts: report.attempts.map((attempt) => ({
        id: attempt.attempt_id,
        run: attempt.run,
        round: attempt.round,
        startedAt: attempt.started_at,
        outcome: attempt.outcome,
        termination: `${attempt.termination.reason}: ${attempt.termination.detail}`,
        model: attempt.agent.model,
        costMicros: attempt.cost.micros,
        costBasis: attempt.cost.basis,
        partial: attempt.cost.partial,
        ceilings: attempt.ceilings,
        review: attempt.review,
        reviewDecision: attempt.review_decision,
        changes: attempt.changed_files ?? [],
        checks: (attempt.checks ?? []).map((check) => ({
          name: check.name ?? check.check_id ?? "Check",
          status: check.status,
          detail: [
            check.command,
            check.summary,
            check.detail ??
              (check.output === undefined
                ? null
                : typeof check.output === "string"
                  ? check.output
                  : JSON.stringify(check.output, null, 2)),
          ]
            .filter(Boolean)
            .join("\n\n"),
        })),
        verification: attempt.verification,
        bundles: attempt.bundles,
      })),
      cost: {
        micros: report.total_cost.micros,
        partial:
          report.total_cost.partial > 0 || report.total_cost.unavailable > 0,
        unavailable: report.total_cost.unavailable,
      },
      principles: existsSync(principlesPath)
        ? readFileSync(principlesPath, "utf8").slice(0, 100_000)
        : "",
      verdicts: report.verdicts,
      effective: {
        minutes: limits["attempt_wall_clock_ms"]! / 60_000,
        commands: limits["attempt_commands"]!,
        ticketDollars: limits["ticket_cost_micros"]! / 1_000_000,
      },
      report,
    };
  }
  private async output(
    repoId: string,
    key: string,
    attemptId?: string,
  ): Promise<ReplyMap["output"]> {
    const repo = this.repository(repoId),
      detail = await this.detail(repoId, key);
    const attempt = attemptId
      ? detail.attempts.find((entry) => entry.id === attemptId)
      : detail.attempts.at(-1);
    if (attemptId && !attempt)
      throw new Error("The selected attempt does not belong to this task.");
    const bundle = attempt?.bundles.find(
      (bundle) =>
        bundle.kind === "execution" &&
        bundle.subject_id === attempt.id &&
        bundle.ticket_id === detail.ticket.ticket_id,
    );
    const notes: string[] = [];
    const read = (name: "transcript.jsonl" | "change.diff"): string | null => {
      const artifact = bundle?.artifacts.find(
        (artifact) => artifact.name === name,
      );
      if (!artifact?.retained) return null;
      const result = readObject(
        this.safePath(repo, ".focrux", "bundles", "objects", artifact.sha256),
        artifact,
      );
      if (result.text === null) {
        notes.push(result.note);
        return null;
      }
      return redact(result.text);
    };
    return {
      transcript: read("transcript.jsonl"),
      diff: read("change.diff"),
      notes,
    };
  }
  async providers(): Promise<Provider[]> {
    const probe = async (id: "claude" | "codex"): Promise<Provider> => {
      const base = {
        id,
        name: id === "claude" ? "Claude Code" : "Codex",
        loginCommand: LOGIN_COMMANDS[id].join(" "),
        roles:
          id === "claude"
            ? ["Execution", "Independent review", "Planning"]
            : ["Execution", "Independent review", "Planning"],
      };
      try {
        const result = await this.execute(
          id,
          id === "claude" ? ["auth", "status", "--json"] : ["login", "status"],
          { cwd: this.options.dataDirectory, timeoutMs: 12_000 },
        );
        const logged =
          id === "claude"
            ? z
                .object({
                  loggedIn: z.boolean(),
                  authMethod: z.string().optional(),
                })
                .safeParse(JSON.parse(result.stdout || "{}"))
            : null;
        const authenticated =
          id === "claude"
            ? logged?.success === true && logged.data.loggedIn
            : result.code === 0;
        const subscription =
          id === "claude"
            ? logged?.success === true &&
              /oauth|subscription/i.test(logged.data.authMethod ?? "")
            : /chatgpt/i.test(result.stdout + result.stderr);
        return {
          ...base,
          installed: true,
          authenticated,
          detail: authenticated
            ? subscription
              ? "Signed in with your subscription"
              : "Signed in · credential managed by the CLI"
            : "Installed · sign in through your terminal, then refresh",
        };
      } catch {
        return {
          ...base,
          installed: false,
          authenticated: false,
          detail: "CLI unavailable. Install it, sign in, then refresh.",
        };
      }
    };
    const providers = await Promise.all([probe("claude"), probe("codex")]);
    return [
      ...providers,
      {
        id: "anthropic",
        name: "Anthropic API · optional",
        installed: true,
        authenticated: Boolean(process.env.ANTHROPIC_API_KEY),
        detail: process.env.ANTHROPIC_API_KEY
          ? "Environment credential available · metered API usage"
          : "No ANTHROPIC_API_KEY in the app environment",
        loginCommand: "",
        roles: ["Independent review"],
      },
    ];
  }
  private start(
    repoId: string,
    key: string | null,
    kind: string,
    label: string,
    operation: (job: Job, signal: AbortSignal) => Promise<void>,
    owner?: EditingOwner,
  ): Job {
    if (this.active)
      throw new Error(
        "Another command is active. Wait for it to finish or stop it before starting this one.",
      );
    const controller = new AbortController();
    const job: Job = {
      id: randomUUID(),
      repoId,
      key,
      kind,
      label,
      state: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      log: "",
      error: null,
      resultKey: null,
      result: null,
      ...(owner ? { editing: owner } : {}),
    };
    this.state.jobs = [...this.state.jobs.slice(-39), job];
    // Reserve the slot synchronously, before operation can yield or another IPC request can enter.
    const done = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted)
          throw new Error("Command cancelled before starting");
        return operation(job, controller.signal);
      })
      .then(() => {
        job.state = controller.signal.aborted ? "cancelled" : "completed";
      })
      .catch((error: unknown) => {
        job.error = redact(
          error instanceof Error ? error.message : String(error),
        );
        job.state = controller.signal.aborted ? "cancelled" : "failed";
      })
      .finally(async () => {
        job.endedAt = new Date().toISOString();
        this.reads.invalidate(repoId);
        try {
          await this.editing.settled(job);
          this.active = null;
          this.changed(true, {
            kind: "records",
            repoId,
            key: job.resultKey ?? key,
            job,
          });
          this.updatePower();
          await this.notifyOutcome(job);
        } catch (error) {
          this.active = null;
          job.error = `Could not save the command status: ${redact(String(error))}`;
          job.state = "failed";
          this.changed(false, {
            kind: "records",
            repoId,
            key: job.resultKey ?? key,
            job,
          });
          this.updatePower();
        }
      });
    this.active = { id: job.id, controller, done };
    try {
      if (owner) this.editing.started(owner, job);
      this.changed(true, { kind: "progress", job });
      this.updatePower();
    } catch (error) {
      controller.abort();
      throw error;
    }
    return job;
  }
  private async invoke(
    job: Job,
    repo: z.infer<typeof RepoSchema>,
    args: string[],
    signal: AbortSignal,
    allowFailure = false,
  ): Promise<ProcessResult> {
    const result = await this.cli(args, repo, {
      signal,
      timeoutMs: 12 * 60 * 60 * 1000,
      onOutput: (output) => {
        if (job.log === output) return;
        job.log = output;
        this.changed(Date.now() - this.lastSave > 1500, {
          kind: "progress",
          job,
        });
        this.notifyStage(job);
      },
    });
    job.log = redact(
      [result.stderr, result.stdout].filter(Boolean).join("\n"),
    ).slice(-80_000);
    if (!allowFailure) this.requireSuccess(result);
    if (result.stdout.trim()) {
      try {
        job.result = JSON.parse(result.stdout);
      } catch {
        job.result = null;
      }
    }
    return result;
  }
  private draftArgs(draft: Draft): string[] {
    // The CLI's non-interactive edit syntax has a delimiter; reject ambiguous text instead of silently splitting it.
    for (const criterion of draft.criteria)
      if (criterion.text.includes("::") || criterion.assertion.includes("::"))
        throw new Error(
          "Use a single colon in a criterion. The CLI reserves a double colon for its verification separator.",
        );
    return [
      "--outcome",
      draft.outcome,
      ...draft.criteria.flatMap((entry) => [
        "--criterion",
        `${entry.text} :: ${entry.assertion} :: ${entry.kind}`,
      ]),
      ...draft.paths.flatMap((path) => ["--path", path]),
      "--json",
    ];
  }
  async request<T extends Request>(input: T): Promise<ReplyMap[T["kind"]]> {
    const request = RequestSchema.parse(input);
    return (await this.dispatch(request)) as ReplyMap[T["kind"]];
  }
  private async dispatch(
    request: Request,
    owner?: EditingOwner,
  ): Promise<unknown> {
    if (request.kind === "editingOpen")
      return this.editing.open(request.target, request.legacy);
    if (request.kind === "editingRead") return this.editing.read(request.id);
    if (request.kind === "editingSave")
      return this.editing.save(
        request.id,
        request.revision,
        request.repoId,
        request.form,
      );
    if (request.kind === "editingSubmit")
      return this.editing.submit(
        request.id,
        request.revision,
        request.operationId,
        request.intent,
      );
    if (request.kind === "editingStop") return this.editing.stop(request.id);
    if (request.kind === "editingDiscard")
      return this.editing.discard(request.id, request.revision);
    if (request.kind === "snapshot") return this.snapshot();
    if (request.kind === "repositorySnapshot")
      return this.repositorySnapshot(request.repoId);
    if (request.kind === "providers") return this.providers();
    if (request.kind === "login") {
      const command = LOGIN_COMMANDS[request.provider];
      if (!this.options.io.openTerminal)
        throw new Error(
          `Run ${command.join(" ")} in your terminal, then refresh the connection.`,
        );
      await this.options.io.openTerminal(command);
      return null;
    }
    if (request.kind === "models") return discoverModels(request.provider);
    if (request.kind === "exportArchive") {
      if (request.repoId !== null) this.repository(request.repoId);
      const snapshot = await this.snapshot();
      return this.options.io.saveFile(
        "focrux-archive.csv",
        redact(archiveCsv(archiveRows(snapshot, request), snapshot.titles)),
      );
    }
    if (request.kind === "openHelp") {
      await this.options.io.openExternal(HELP_LINKS[request.page]);
      return null;
    }
    if (request.kind === "chooseRepository") {
      const path = await this.options.io.chooseDirectory();
      return path === null ? null : this.registerRepository(path);
    }
    if (request.kind === "saveSettings") {
      this.state.settings = request.settings;
      this.preferencesChanged();
      this.options.io.applyTheme?.(request.settings.theme);
      this.updatePower();
      return request.settings;
    }
    if (request.kind === "usage") return this.usage();
    if (request.kind === "cancel") {
      if (this.active?.id !== request.jobId)
        throw new Error("That command is no longer active.");
      const job = this.state.jobs.find((entry) => entry.id === request.jobId)!;
      job.state = "stopping";
      this.active.controller.abort();
      this.changed(true, { kind: "progress", job });
      return null;
    }
    const repo = this.repository(request.repoId);
    if (request.kind === "forgetRepository") {
      if (this.active)
        throw new Error(
          "Wait for the active command before disconnecting a repository.",
        );
      this.state.repositories = this.state.repositories.filter(
        (entry) => entry.id !== repo.id,
      );
      // Its tickets' titles, models and archive marks go with it; a reconnection gets a fresh id anyway.
      const prefix = repo.id + ":";
      for (const entry of Object.keys(this.state.titles))
        if (entry.startsWith(prefix)) delete this.state.titles[entry];
      for (const entry of Object.keys(this.state.taskModels))
        if (entry.startsWith(prefix)) delete this.state.taskModels[entry];
      this.state.archived = this.state.archived.filter(
        (entry) => !entry.startsWith(prefix),
      );
      this.changed(true, { kind: "repositories" });
      this.changed(false, {
        kind: "preferences",
        settings: this.state.settings,
        titles: this.state.titles,
        taskModels: this.state.taskModels,
        archived: this.state.archived,
      });
      return null;
    }
    if (request.kind === "detail") return this.detail(repo.id, request.key);
    if (request.kind === "taskSummary")
      return this.taskSummary(repo.id, request.key);
    if (request.kind === "discard") {
      if (this.active)
        throw new Error(
          "Wait for the active command before deleting a contract.",
        );
      const ticket = (await this.list(repo)).tickets.find(
        (entry) => entry.key === request.key,
      );
      if (!ticket)
        throw new Error(
          "This task is no longer in the repository's ticket store.",
        );
      if (
        ![
          "draft",
          "specifying",
          "plan_review",
          "ready",
          "plan_invalid",
        ].includes(ticket.state)
      )
        throw new Error(
          "Only a contract that has never run can be deleted. This one has moved past the contract stage.",
        );
      const attempts = readAttempts(
        this.safePath(
          repo,
          ".focrux",
          "state",
          `${ticket.ticket_id}.attempts.json`,
        ),
      );
      const bundles = listBundles(
        this.safePath(repo, ".focrux", "bundles", "bundles"),
      );
      if (
        attempts.attempts.length ||
        attempts.error ||
        bundles.some((bundle) => bundle.ticket_id === ticket.ticket_id)
      )
        throw new Error(
          "This contract has recorded attempts or evidence, so it stays. Only a never-run contract can be deleted.",
        );
      if (ticket.delivery.pull_request_url)
        throw new Error(
          "This contract has a pull request on record, so it stays.",
        );
      for (const suffix of [".json", ".contract.json", ".draft.json"]) {
        const path = this.safePath(
          repo,
          ".focrux",
          "tickets",
          `${request.key}${suffix}`,
        );
        if (existsSync(path) && !lstatSync(path).isSymbolicLink()) rmSync(path);
      }
      const entry = repo.id + ":" + request.key;
      delete this.state.titles[entry];
      delete this.state.taskModels[entry];
      this.state.archived = this.state.archived.filter(
        (item) => item !== entry,
      );
      for (const session of this.state.editingSessions)
        if (
          session.repoId === repo.id &&
          session.key === request.key &&
          session.phase !== "discarded"
        ) {
          session.phase = "discarded";
          session.resumeNew = false;
          session.revision++;
        }
      this.changed(true, { kind: "records", repoId: repo.id, key: null });
      this.preferencesChanged();
      return null;
    }
    if (request.kind === "archive") {
      const list = await this.list(repo);
      const keys = [...new Set(request.keys)];
      if (
        keys.some((key) => !list.tickets.some((ticket) => ticket.key === key))
      )
        throw new Error(
          "A ticket to file is not in the repository's ticket store.",
        );
      const entries = keys.map((key) => repo.id + ":" + key);
      this.state.archived = request.archived
        ? [...new Set([...this.state.archived, ...entries])]
        : this.state.archived.filter((entry) => !entries.includes(entry));
      this.preferencesChanged();
      return null;
    }
    if (request.kind === "output")
      return this.output(repo.id, request.key, request.attemptId);
    if (request.kind === "manifest" || request.kind === "saveManifest") {
      const path = this.safePath(repo, ".focrux", "config.json");
      if (!existsSync(path))
        throw new Error(
          "Run the environment check and save its proposed configuration first.",
        );
      const text = readFileSync(path, "utf8");
      const digest = createHash("sha256").update(text).digest("hex");
      const config = z.record(z.string(), z.unknown()).parse(JSON.parse(text));
      const manifest = MaterializationManifestSchema.parse(
        config["materialization_manifest"],
      );
      if (request.kind === "manifest")
        return {
          digest,
          testCommand: manifest.verify.command.join(" "),
          value: ManifestEditorSchema.parse({
            entries: manifest.entries,
            offLimits: config["protected_paths"] ?? [],
          }),
        };
      if (this.active)
        throw new Error(
          "Wait for the active command before changing the manifest.",
        );
      if (digest !== request.digest)
        throw new Error(
          "The repository configuration changed. Reopen the manifest before saving.",
        );
      config["materialization_manifest"] = MaterializationManifestSchema.parse({
        ...manifest,
        entries: request.value.entries,
      });
      config["protected_paths"] = request.value.offLimits;
      const temporary = this.safePath(
        repo,
        ".focrux",
        `config-${randomUUID()}.tmp`,
      );
      writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporary, path);
      this.changed(true, { kind: "records", repoId: repo.id, key: null });
      return null;
    }
    if (request.kind === "rename") {
      this.readContract(repo, request.key);
      this.state.titles[repo.id + ":" + request.key] = request.title;
      this.preferencesChanged();
      return null;
    }
    if (request.kind === "openRepository") {
      await this.options.io.openPath(repo.path);
      return null;
    }
    if (request.kind === "openWorktree") {
      const { contract } = this.readContract(repo, request.key);
      // A branch the ticket's records already name is kept; a name is derived
      // only where none is (D-098).
      const ticket = (await this.list(repo)).tickets.find(
        (entry) => entry.key === request.key,
      );
      const attempts = readAttempts(
        this.safePath(
          repo,
          ".focrux",
          "state",
          `${contract.ticket_id}.attempts.json`,
        ),
      ).attempts;
      const branch =
        "refs/heads/" +
        (recordedBranch(
          {
            delivery: ticket?.delivery.branch,
            attempt: attempts.at(-1)?.branch,
          },
          contract.ticket_id,
        ) ??
          branchName({
            ticket_key: ticket?.key ?? request.key,
            ticket_id: contract.ticket_id,
            outcome: contract.outcome,
          }));
      const listed = this.requireSuccess(
        await this.execute("git", ["worktree", "list", "--porcelain", "-z"], {
          cwd: repo.path,
        }),
      );
      const entry = listed
        .split("\0\0")
        .find((record) => record.split("\0").includes("branch " + branch));
      const path = entry
        ?.split("\0")
        .find((field) => field.startsWith("worktree "))
        ?.slice(9);
      if (!path || !isAbsolute(path) || !existsSync(path))
        throw new Error(
          "This task has no materialized worktree available. Its retained changes remain in the run record.",
        );
      const canonical = realpathSync(path);
      if (canonical === repo.path)
        throw new Error(
          "The task's worktree resolves to the primary checkout.",
        );
      await this.options.io.openPath(canonical);
      return null;
    }
    if (request.kind === "openPullRequest") {
      const detail = await this.detail(repo.id, request.key),
        url = detail.ticket.delivery.pull_request_url;
      if (
        !url ||
        !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(
          url,
        )
      )
        throw new Error("This task has no supported GitHub pull-request URL.");
      await this.options.io.openExternal(url);
      return null;
    }
    if (request.kind === "export") {
      const content = request.key
        ? JSON.stringify(await this.detail(repo.id, request.key), null, 2)
        : JSON.stringify(
            (await this.snapshot()).tasks.filter(
              (row) => row.repoId === repo.id,
            ),
            null,
            2,
          );
      return this.options.io.saveFile(
        `focrux-${request.key ?? repo.name}.json`,
        redact(content),
      );
    }
    if (request.kind === "doctor")
      return this.start(
        repo.id,
        null,
        request.kind,
        request.writeConfig
          ? "Save repository configuration"
          : "Check repository readiness",
        async (job, signal) => {
          const models = this.state.settings;
          const path = join(
            this.options.dataDirectory,
            `doctor-${job.id}.json`,
          );
          writeFileSync(
            path,
            JSON.stringify({
              agent_binary:
                models.executorProvider === "codex-cli" ? "codex" : "claude",
              agent_provider: models.executorProvider,
              model: models.executorModel,
              reviewer_provider: models.reviewerProvider,
              reviewer_model: models.reviewerModel,
            }),
            { mode: 0o600, flag: "wx" },
          );
          await this.invoke(
            job,
            repo,
            [
              "doctor",
              "--json",
              "--config",
              path,
              ...(request.writeConfig ? ["--write-config"] : []),
            ],
            signal,
          );
        },
      );
    if (request.kind === "draft" || request.kind === "admit")
      return this.start(
        repo.id,
        null,
        request.kind,
        request.kind === "draft"
          ? "Draft a task contract"
          : "Save task contract",
        async (job, signal) => {
          let args: string[];
          if (request.kind === "draft") {
            const path = join(
              this.options.dataDirectory,
              `source-${job.id}.md`,
            );
            writeFileSync(path, request.outcome, { mode: 0o600, flag: "wx" });
            args = [
              "admit",
              "--prefix",
              "FCX",
              "--from-file",
              path,
              "--provider",
              request.models?.draftingProvider ??
                this.state.settings.draftingProvider,
              "--model",
              request.models?.executorModel ??
                this.state.settings.executorModel,
              "--json",
            ];
          } else
            args = [
              "admit",
              "--prefix",
              "FCX",
              ...this.draftArgs(DraftSchema.parse(request.draft)),
            ];
          await this.invoke(job, repo, args, signal);
          const admitted = z.object({ ticket: TicketSchema }).parse(job.result);
          job.resultKey = admitted.ticket.key;
          if (request.models) {
            this.state.taskModels[repo.id + ":" + admitted.ticket.key] =
              request.models;
            this.preferencesChanged();
          }
        },
        owner,
      );
    if (request.kind === "edit")
      return this.start(
        repo.id,
        request.key,
        request.kind,
        "Update task contract",
        async (job, signal) => {
          this.assertDigest(repo, request.key, request.digest);
          const current = this.readContract(repo, request.key).contract;
          if (
            "acceptance_criteria" in current &&
            current.acceptance_criteria.some(
              (criterion) => criterion.expected_verification.kind === "manual",
            )
          )
            throw new Error(
              "This contract has named manual reviewers. Edit it with the CLI to preserve those assignments.",
            );
          await this.invoke(
            job,
            repo,
            ["edit", request.key, ...this.draftArgs(request.draft)],
            signal,
          );
          job.resultKey = request.key;
          if (request.models) {
            this.state.taskModels[repo.id + ":" + request.key] = request.models;
            this.preferencesChanged();
          }
        },
        owner,
      );
    if (request.kind === "sync")
      return this.start(
        repo.id,
        request.key,
        request.kind,
        "Refresh delivery from GitHub",
        async (job, signal) => {
          await this.invoke(job, repo, ["sync", request.key], signal);
        },
      );
    if (request.kind === "principle")
      return this.start(
        repo.id,
        request.key,
        request.kind,
        "Record a product decision",
        async (job, signal) => {
          await this.invoke(
            job,
            repo,
            ["principle", "add", request.answer],
            signal,
          );
        },
      );
    if (request.kind === "verdict")
      return this.start(
        repo.id,
        request.key,
        request.kind,
        "Record finding feedback",
        async (job, signal) => {
          await this.invoke(
            job,
            repo,
            [
              "verdict",
              request.key,
              `--${request.decision}`,
              request.findingKey,
              "--note",
              request.note,
              "--author",
              this.state.settings.name || "Local user",
              "--json",
            ],
            signal,
          );
        },
      );
    if (request.kind === "run" || request.kind === "decide")
      return this.start(
        repo.id,
        request.key,
        request.kind,
        "Run engineering loop",
        async (job, signal) => {
          this.assertDigest(repo, request.key, request.digest);
          const resumeFrom = request.kind === "run" ? request.resumeFrom : null;
          if (resumeFrom) {
            const current = await this.detail(repo.id, request.key);
            if (
              !current.attempts.some((attempt) =>
                attempt.bundles.some(
                  (bundle) =>
                    bundle.bundle_id === resumeFrom &&
                    bundle.kind === "execution",
                ),
              )
            )
              throw new Error(
                "The recovery bundle does not belong to this task.",
              );
          }
          if (request.kind === "decide") {
            await this.invoke(
              job,
              repo,
              ["principle", "add", request.answer],
              signal,
            );
            if (signal.aborted) return;
          }
          // Always carry explicit publication authority and person-only merge into this one invocation.
          const models =
            this.state.taskModels[repo.id + ":" + request.key] ??
            this.state.settings;
          const config = {
            agent_binary:
              models.executorProvider === "codex-cli" ? "codex" : "claude",
            agent_provider: models.executorProvider,
            executor_skills: models.executorSkills,
            model: models.executorModel,
            reviewer_provider: models.reviewerProvider,
            reviewer_model: models.reviewerModel,
            limits: this.limits(repo),
            publish: request.kind === "run" ? request.publish : false,
            merge: "person",
          };
          const path = join(this.options.dataDirectory, `run-${job.id}.json`);
          writeFileSync(path, JSON.stringify(config), {
            mode: 0o600,
            flag: "wx",
          });
          if (request.kind === "run" && request.approve)
            await this.invoke(
              job,
              repo,
              ["approve", request.key, "--json"],
              signal,
            );
          if (signal.aborted) return;
          await this.invoke(
            job,
            repo,
            [
              "run",
              "--ticket",
              request.key,
              "--config",
              path,
              "--json",
              ...(resumeFrom ? ["--resume-from", resumeFrom] : []),
            ],
            signal,
          );
        },
      );
    const unreachable: never = request;
    throw new Error(`Unsupported request ${String(unreachable)}`);
  }
  private async taskSummary(repoId: string, key: string): Promise<TaskSummary> {
    return this.reads.read(
      "summary:" + repoId + ":" + key,
      repoId,
      async () => {
        const repo = this.repository(repoId);
        const ticket = (await this.list(repo)).tickets.find(
          (entry) => entry.key === key,
        );
        if (!ticket)
          throw new Error(
            "This task is no longer in the repository's ticket store.",
          );
        const record = readAttempts(
          this.safePath(
            repo,
            ".focrux",
            "state",
            `${ticket.ticket_id}.attempts.json`,
          ),
        );
        const bundles = record.attempts.length
          ? await this.reads.read("bundles:" + repoId, repoId, async () =>
              listBundles(this.safePath(repo, ".focrux", "bundles", "bundles")),
            )
          : [];
        return summariseTicket({
          ticket,
          attempts: record.attempts,
          attemptsError: record.error,
          bundles,
          objectsDirectory: this.safePath(
            repo,
            ".focrux",
            "bundles",
            "objects",
          ),
        });
      },
    );
  }
  /** The month's ledger from retained attempts, and each provider's own account of its plan (S6E). */
  private async usage(): Promise<UsageReport> {
    const records: { ticket: Ticket; attempts: StoredAttempt[] }[] = [];
    const notes: string[] = [];
    for (const repo of this.state.repositories) {
      try {
        this.repository(repo.id);
        for (const ticket of (await this.list(repo)).tickets) {
          const record = readAttempts(
            this.safePath(
              repo,
              ".focrux",
              "state",
              `${ticket.ticket_id}.attempts.json`,
            ),
          );
          if (record.error)
            notes.push(`${repo.name} · ${ticket.key}: ${record.error}`);
          records.push({ ticket, attempts: record.attempts });
        }
      } catch (error) {
        notes.push(`${repo.name}: ${redact(String(error))}`);
      }
    }
    const settings = this.state.settings;
    const roleOf = (
      id: "claude-cli" | "codex-cli" | "anthropic",
    ): string | null =>
      [
        settings.executorProvider === id && "default executor",
        settings.reviewerProvider === id && "default reviewer",
      ]
        .filter(Boolean)
        .join(" · ") || null;
    const providers = await this.providers();
    const signedIn = (id: Provider["id"]): boolean =>
      providers.find((provider) => provider.id === id)?.authenticated ?? false;
    const codex = signedIn("codex")
      ? await (this.options.usageProbe ?? codexUsage)()
      : {
          plan: null,
          windows: null,
          detail: "Codex is not signed in on this machine.",
        };
    return {
      readAt: new Date().toISOString(),
      ledger: ledgerFor(records, currentMonth()),
      providers: [
        {
          id: "claude",
          name: "Claude Code",
          role: roleOf("claude-cli"),
          plan: null,
          windows: null,
          detail: signedIn("claude")
            ? "Claude Code reports a limit only when a run meets one; there is no window to read without spending a turn."
            : "Claude Code is not signed in on this machine.",
        },
        { id: "codex", name: "Codex", role: roleOf("codex-cli"), ...codex },
        {
          id: "anthropic",
          name: "Anthropic API",
          role: roleOf("anthropic"),
          plan: null,
          windows: null,
          detail: signedIn("anthropic")
            ? "Metered API usage; the API reports no plan window."
            : "No API key in the app environment.",
        },
      ],
      notes,
    };
  }
  private power: PowerState = { holding: false, detail: null, since: null };
  /** AFK mode (S6F): the machine is held awake only while a run or decision is live, and only as the settings allow. */
  updatePower(): void {
    const afk = this.state.settings.afk;
    const live = this.active
      ? this.state.jobs.find((job) => job.id === this.active?.id)
      : undefined;
    const running =
      live &&
      ["run", "decide"].includes(live.kind) &&
      ["running", "stopping"].includes(live.state)
        ? live
        : undefined;
    const onBattery = this.options.io.onBattery?.() ?? false;
    const hold = Boolean(
      afk.holdSleep && running && !(afk.releaseOnBattery && onBattery),
    );
    const detail = hold
      ? `Holding sleep now — ${running?.key ?? "a run"} is running.`
      : running && afk.holdSleep
        ? "Released on battery power."
        : null;
    if (hold === this.power.holding && detail === this.power.detail) return;
    this.power = {
      holding: hold,
      detail,
      since: hold
        ? this.power.holding
          ? this.power.since
          : new Date().toISOString()
        : null,
    };
    this.options.io.holdSleep?.(hold, afk.displaySleep);
    this.options.changed({
      kind: "power",
      power: this.power,
      sequence: ++this.sequence,
    });
  }
  /** Called by the host when the machine moves between mains and battery. */
  powerChanged(): void {
    this.updatePower();
  }
  private readonly stages = new Map<string, string>();
  private notify(title: string, body: string): void {
    this.options.io.notify(title, body, {
      silent: !this.state.settings.notifySound,
    });
  }
  private notifyStage(job: Job): void {
    if (
      !this.state.settings.notifyOn.stage ||
      !["run", "decide"].includes(job.kind)
    )
      return;
    const observed = runnerProgress(job.log);
    if (!observed || this.stages.get(job.id) === observed.title) return;
    this.stages.set(job.id, observed.title);
    this.notify(
      `${job.key ?? "Task"} · ${observed.title}`,
      "The loop moved to a new stage.",
    );
  }
  /** The four moments a person asked to be interrupted for, read from the recorded outcome rather than the process exit. */
  private async notifyOutcome(job: Job): Promise<void> {
    this.stages.delete(job.id);
    const on = this.state.settings.notifyOn;
    if (!["run", "decide"].includes(job.kind) || !job.key) return;
    const repo = this.state.repositories.find(
      (entry) => entry.id === job.repoId,
    );
    if (!repo) return;
    let ticket: Ticket | undefined;
    try {
      ticket = (await this.list(repo)).tickets.find(
        (entry) => entry.key === job.key,
      );
    } catch {
      return;
    }
    if (!ticket) return;
    const reason = readAttempts(
      this.safePath(
        repo,
        ".focrux",
        "state",
        `${ticket.ticket_id}.attempts.json`,
      ),
    ).attempts.at(-1)?.termination?.reason;
    if (on.ceiling && isCeilingStop(reason))
      this.notify(
        `${ticket.key} stopped at a ceiling`,
        "The loop stopped and nothing was lost. Open the task to raise the ceiling or recover.",
      );
    else if (on.decision && ticket.state === "changes_requested")
      this.notify(
        `${ticket.key} needs a decision`,
        "The loop is paused until you answer.",
      );
    else if (
      on.review &&
      job.state === "completed" &&
      ["pr_open", "ready", "merged"].includes(ticket.state)
    )
      this.notify(
        `${ticket.key} · review finished`,
        ticket.delivery.pull_request_url
          ? "The pull request is open. The merge is yours."
          : "The result is ready to review.",
      );
    else if (on.review && job.state === "failed")
      this.notify(
        `${ticket.key} · the loop stopped`,
        job.error ?? "Open the task to inspect the cause.",
      );
  }
  async shutdown(): Promise<void> {
    this.active?.controller.abort();
    await this.active?.done;
  }
}
