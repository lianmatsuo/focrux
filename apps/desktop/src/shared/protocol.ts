import { z } from "zod";
import { ExecutorSkillsSchema } from "@focrux/contracts/executor-skills";
import { MaterializationEntrySchema } from "@focrux/contracts/materialisation-entry";
import type {
  PlanContract,
  ReviewArtifact,
  RunBundle,
  Ticket,
} from "@focrux/contracts";
import { BindingSchema, ShortcutActionSchema } from "./shortcuts.js";

const identifier = z.string().uuid();
const key = z.string().regex(/^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,6}$/);
const text = z.string().trim().min(1).max(12_000);
/** The four moments the loop may interrupt a person (S6F). */
export const NotifyOnSchema = z.strictObject({
  decision: z.boolean().default(true),
  review: z.boolean().default(true),
  ceiling: z.boolean().default(true),
  stage: z.boolean().default(false),
});
export type NotifyOn = z.infer<typeof NotifyOnSchema>;
export const AfkSchema = z.strictObject({
  holdSleep: z.boolean().default(false),
  displaySleep: z.boolean().default(true),
  releaseOnBattery: z.boolean().default(true),
});
export type Afk = z.infer<typeof AfkSchema>;
export const SettingsSchema = z.strictObject({
  name: z.string().trim().max(60).default(""),
  onboardingComplete: z.boolean().default(false),
  executorProvider: z.enum(["claude-cli", "codex-cli"]).default("claude-cli"),
  executorSkills: ExecutorSkillsSchema.default([]),
  executorModel: z.string().trim().min(1).max(100).default("claude-opus-5"),
  reviewerModel: z.string().trim().min(1).max(100).default("claude-opus-5"),
  reviewerProvider: z
    .enum(["claude-cli", "codex-cli", "anthropic"])
    .default("claude-cli"),
  draftingProvider: z.enum(["claude-cli", "codex-cli"]).default("claude-cli"),
  minutes: z.number().int().min(1).max(120).default(30),
  commands: z.number().int().min(1).max(1000).default(200),
  ticketDollars: z.number().min(0.1).max(1000).default(60),
  /** The pre-v2 master switch, kept so an older profile parses; `notifyOn` is the setting. */
  notifications: z.boolean().default(false),
  notifyOn: NotifyOnSchema.default({ decision: true, review: true, ceiling: true, stage: false }),
  notifySound: z.boolean().default(false),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  textSize: z.enum(["small", "default", "large"]).default("default"),
  reduceMotion: z.boolean().default(false),
  afk: AfkSchema.default({ holdSleep: false, displaySleep: true, releaseOnBattery: true }),
  shortcuts: z.partialRecord(ShortcutActionSchema, BindingSchema).default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const TaskModelsSchema = SettingsSchema.pick({
  executorProvider: true,
  executorModel: true,
  reviewerProvider: true,
  reviewerModel: true,
  draftingProvider: true,
  executorSkills: true,
});
export type TaskModels = z.infer<typeof TaskModelsSchema>;
export const ModelProviderSchema = z.enum([
  "claude-cli",
  "codex-cli",
  "anthropic",
]);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export const ProviderModelSchema = z.strictObject({
  id: z.string().trim().min(1).max(100),
  label: z.string().min(1).max(200),
  description: z.string().max(2000),
  isDefault: z.boolean(),
});
export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export const ModelCatalogSchema = z.strictObject({
  provider: ModelProviderSchema,
  models: z.array(ProviderModelSchema).max(1000),
  source: z.enum([
    "claude-code",
    "codex-app-server",
    "anthropic-api",
    "sample",
  ]),
  discoveredAt: z.string().datetime(),
});
export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
export const CriterionSchema = z.strictObject({
  text,
  assertion: text,
  kind: z.enum(["test", "query", "metric", "artifact"]),
});
export const DraftSchema = z.strictObject({
  outcome: text,
  criteria: z.array(CriterionSchema).min(1).max(20),
  paths: z.array(z.string().trim().min(1).max(300)).min(1).max(40),
});
export type Draft = z.infer<typeof DraftSchema>;
// Editing accepts incomplete text. Admission still uses DraftSchema.
const editableCriterion = z.strictObject({
  text: z.string().max(12_000),
  assertion: z.string().max(12_000),
  kind: z.enum(["test", "query", "metric", "artifact"]),
});
export const EditingFormSchema = z.strictObject({
  draft: z.strictObject({
    outcome: z.string().max(12_000),
    criteria: z.array(editableCriterion).max(20),
    paths: z.array(z.string().max(300)).max(40),
  }),
  models: TaskModelsSchema,
  step: z.union([z.literal(1), z.literal(2)]),
  editing: z.number().int().min(0).max(19).nullable(),
  criterion: editableCriterion,
  newPath: z.string().max(300).nullable(),
});
export type EditingForm = z.infer<typeof EditingFormSchema>;
export const EditingOperationSchema = z.strictObject({
  id: identifier,
  intent: z.enum(["draft", "compile"]),
  inputRevision: z.number().int().nonnegative(),
  jobId: identifier.nullable(),
  state: z.enum(["accepted", "running", "stopping", "completed", "failed", "cancelled", "interrupted"]),
  resultKey: key.nullable(),
  error: z.string().nullable(),
  reconciled: z.boolean(),
});
export const EditingSessionSchema = z.strictObject({
  version: z.literal(1),
  id: identifier,
  repoId: identifier,
  key: key.nullable(),
  digest: z.string().length(64).nullable(),
  revision: z.number().int().nonnegative(),
  resumeNew: z.boolean(),
  form: EditingFormSchema,
  phase: z.enum(["editing", "working", "ready", "conflict", "outcome-unknown", "discarded"]),
  error: z.string().nullable(),
  operation: EditingOperationSchema.nullable(),
});
export type EditingSession = z.infer<typeof EditingSessionSchema>;
export type EditingOperation = z.infer<typeof EditingOperationSchema>;
export const EditingTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new"), repoId: identifier }),
  z.strictObject({ kind: z.literal("ticket"), repoId: identifier, key }),
  z.strictObject({ kind: z.literal("session"), id: identifier }),
]);
export type EditingTarget = z.infer<typeof EditingTargetSchema>;
export const LegacyEditingSchema = z.strictObject({
  repoId: identifier,
  key: key.nullable(),
  digest: z.string().length(64).nullable(),
  form: EditingFormSchema,
  pending: z.boolean(),
});
export type LegacyEditing = z.infer<typeof LegacyEditingSchema>;
const reference = { repoId: identifier, key };
export const HELP_LINKS = {
  documentation: "https://github.com/lianmatsuo/focrux#readme",
  problem: "https://github.com/lianmatsuo/focrux/issues/new",
  releases: "https://github.com/lianmatsuo/focrux/releases",
  privacy:
    "https://github.com/lianmatsuo/focrux/blob/main/docs/08-security-autonomy-and-data.md",
} as const;
export const ManifestEditorSchema = z.strictObject({
  entries: z.array(MaterializationEntrySchema).max(100),
  offLimits: z.array(z.string().trim().min(1).max(300)).max(100),
});
export type ManifestEditor = z.infer<typeof ManifestEditorSchema>;
export const RequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("snapshot") }),
  z.strictObject({ kind: z.literal("repositorySnapshot"), repoId: identifier }),
  z.strictObject({ kind: z.literal("editingOpen"), target: EditingTargetSchema, legacy: LegacyEditingSchema.optional() }),
  z.strictObject({ kind: z.literal("editingRead"), id: identifier }),
  z.strictObject({ kind: z.literal("editingSave"), id: identifier, revision: z.number().int().nonnegative(), repoId: identifier, form: EditingFormSchema }),
  z.strictObject({ kind: z.literal("editingSubmit"), id: identifier, revision: z.number().int().nonnegative(), operationId: identifier, intent: z.enum(["draft", "compile"]) }),
  z.strictObject({ kind: z.literal("editingStop"), id: identifier }),
  z.strictObject({ kind: z.literal("editingDiscard"), id: identifier, revision: z.number().int().nonnegative() }),
  z.strictObject({
    kind: z.literal("openHelp"),
    page: z.enum(["documentation", "problem", "releases", "privacy"]),
  }),
  z.strictObject({ kind: z.literal("chooseRepository") }),
  z.strictObject({ kind: z.literal("forgetRepository"), repoId: identifier }),
  z.strictObject({ kind: z.literal("saveSettings"), settings: SettingsSchema }),
  z.strictObject({ kind: z.literal("providers") }),
  /** Opens the machine's terminal on the provider's own sign-in command; the desktop never takes a credential. */
  z.strictObject({ kind: z.literal("login"), provider: z.enum(["claude", "codex"]) }),
  z.strictObject({ kind: z.literal("models"), provider: ModelProviderSchema }),
  z.strictObject({ kind: z.literal("usage") }),
  z.strictObject({ kind: z.literal("detail"), ...reference }),
  z.strictObject({ kind: z.literal("taskSummary"), ...reference }),
  z.strictObject({ kind: z.literal("output"), ...reference, attemptId: z.string().min(1).max(200).optional() }),
  z.strictObject({
    kind: z.literal("exportArchive"),
    repoId: identifier.nullable(),
    search: z.string().max(200),
    outcome: z.enum(["all", "merged", "closed", "cancelled"]),
    sort: z.enum(["newest", "oldest", "title"]),
  }),
  z.strictObject({ kind: z.literal("manifest"), repoId: identifier }),
  z.strictObject({
    kind: z.literal("saveManifest"),
    repoId: identifier,
    digest: z.string().length(64),
    value: ManifestEditorSchema,
  }),
  z.strictObject({
    kind: z.literal("rename"),
    ...reference,
    title: z.string().trim().min(1).max(200),
  }),
  /** Permanently deletes a contract that has never run: no attempt, no bundle, no pull request. */
  z.strictObject({ kind: z.literal("discard"), ...reference }),
  /** Files completed tickets away from Home (S4); a desktop preference, never a Ticket state. */
  z.strictObject({
    kind: z.literal("archive"),
    repoId: identifier,
    keys: z.array(key).min(1).max(1000),
    archived: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("doctor"),
    repoId: identifier,
    writeConfig: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("draft"),
    repoId: identifier,
    outcome: text,
    models: TaskModelsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("admit"),
    repoId: identifier,
    draft: DraftSchema,
    models: TaskModelsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("edit"),
    ...reference,
    digest: z.string().length(64),
    draft: DraftSchema,
    models: TaskModelsSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("run"),
    ...reference,
    digest: z.string().length(64),
    publish: z.boolean(),
    approve: z.boolean(),
    resumeFrom: z
      .string()
      .regex(/^bundle_[0-9a-f]{16}$/)
      .nullable(),
  }),
  z.strictObject({ kind: z.literal("sync"), ...reference }),
  z.strictObject({ kind: z.literal("principle"), ...reference, answer: text }),
  z.strictObject({
    kind: z.literal("decide"),
    ...reference,
    answer: text,
    digest: z.string().length(64),
  }),
  z.strictObject({
    kind: z.literal("verdict"),
    ...reference,
    findingKey: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["endorse", "override", "accept", "reject"]),
    note: text,
  }),
  z.strictObject({ kind: z.literal("cancel"), jobId: identifier }),
  z.strictObject({ kind: z.literal("openRepository"), repoId: identifier }),
  z.strictObject({ kind: z.literal("openWorktree"), ...reference }),
  z.strictObject({ kind: z.literal("openPullRequest"), ...reference }),
  z.strictObject({
    kind: z.literal("export"),
    repoId: identifier,
    key: key.nullable(),
  }),
]);
export type Request = z.infer<typeof RequestSchema>;
export interface Repository {
  id: string;
  name: string;
  path: string;
  branch: string;
  head: string;
  dirty: boolean;
  configured: boolean;
  error: string | null;
  testCommand?: string;
  manifestCount?: number;
  prohibitedPaths?: string[];
}
export interface Provider {
  id: "claude" | "codex" | "anthropic";
  name: string;
  installed: boolean;
  authenticated: boolean;
  detail: string;
  loginCommand: string;
  roles: string[];
}
export interface Job {
  id: string;
  repoId: string;
  key: string | null;
  kind: string;
  label: string;
  state:
    | "running"
    | "stopping"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  startedAt: string;
  endedAt: string | null;
  log: string;
  error: string | null;
  resultKey: string | null;
  result: unknown;
  editing?: { sessionId: string; operationId: string } | undefined;
}
export interface TaskRow {
  repoId: string;
  repository: string;
  ticket: Ticket;
  summary?: {
    description?: string;
    created?: string;
    stage?: number;
    criteriaMet?: number;
    criteriaTotal?: number;
    cost?: string;
    delivery?: string;
    progress?: number;
    elapsed?: string;
    files?: number;
    branch?: string;
    additions?: number;
    deletions?: number;
  };
}
/** Whether the machine is being held awake for a live run (S6F, Away from keyboard). */
export interface PowerState {
  holding: boolean;
  detail: string | null;
  since: string | null;
}
export interface Snapshot {
  mode: "desktop" | "preview";
  version: string;
  settings: Settings;
  repositories: Repository[];
  tasks: TaskRow[];
  jobs: Job[];
  errors: string[];
  titles?: Record<string, string>;
  taskModels?: Record<string, TaskModels>;
  /** `repoId:key` of every completed ticket filed away by hand. */
  archived?: string[];
  power?: PowerState;
  sequence?: number;
  repositoryErrors?: Record<string, string[]>;
  /** Renderer freshness only; never persisted as Ticket state. */
  refreshingRepos?: string[];
}
export interface RepositorySnapshot {
  repository: Repository;
  tasks: TaskRow[];
  errors: string[];
}
const JobUpdateSchema = z.object({
  id: identifier, repoId: identifier, key: key.nullable(), resultKey: key.nullable(),
  kind: z.string(), label: z.string(), state: z.enum(["running", "stopping", "completed", "failed", "cancelled", "interrupted"]),
  startedAt: z.string(), endedAt: z.string().nullable(), log: z.string().max(80_000), error: z.string().nullable(), result: z.unknown(),
  editing: z.object({ sessionId: identifier, operationId: identifier }).optional(),
});
export const PowerStateSchema = z.strictObject({
  holding: z.boolean(),
  detail: z.string().nullable(),
  since: z.string().nullable(),
});
export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("progress"), sequence: z.number().int().nonnegative(), job: JobUpdateSchema }),
  z.object({ kind: z.literal("records"), sequence: z.number().int().nonnegative(), repoId: identifier.nullable(), key: key.nullable(), job: JobUpdateSchema.optional() }),
  z.object({
    kind: z.literal("preferences"), sequence: z.number().int().nonnegative(), settings: SettingsSchema, titles: z.record(z.string(), z.string()),
    taskModels: z.record(z.string(), TaskModelsSchema), archived: z.array(z.string()).default([]),
  }),
  z.object({ kind: z.literal("repositories"), sequence: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("editing"), sequence: z.number().int().nonnegative(), sessionId: identifier }),
  z.object({ kind: z.literal("power"), sequence: z.number().int().nonnegative(), power: PowerStateSchema }),
]);
export type Change = z.infer<typeof ChangeSchema>;
export type ChangeInput = Change extends infer T ? T extends Change ? Omit<T, "sequence"> : never : never;
export interface AttemptView {
  id: string;
  run: number;
  round: number;
  startedAt: string;
  outcome: string;
  termination: string;
  model: string;
  costMicros: number | null;
  costBasis: string;
  partial: boolean;
  ceilings: {
    resource: string;
    used: number | null;
    ceiling: number;
    hit: boolean;
  }[];
  review: ReviewArtifact | null;
  reviewDecision: string | null;
  changes: {
    path: string;
    change_kind: string;
    additions: number | null;
    deletions: number | null;
  }[];
  checks: { name: string; status: string; detail: string }[];
  verification: unknown;
  bundles: RunBundle[];
}
export interface Detail {
  ticket: Ticket;
  contract: PlanContract;
  digest: string;
  attempts: AttemptView[];
  cost: { micros: number; partial: boolean; unavailable: number };
  principles: string;
  verdicts: unknown[];
  effective: { minutes: number; commands: number; ticketDollars: number };
  report: unknown;
  sample?: {
    progress: number;
    stage: number;
    current: string;
    elapsed: string;
    steps: {
      text: string;
      time: string;
      state: "complete" | "current" | "queued";
    }[];
    decisions: DecisionQuestion[];
    transcript: { author: string; label: string; text: string }[];
    terminal: string;
  };
}
export interface DecisionQuestion {
  id: string;
  title: string;
  context: string;
  options: {
    title: string;
    detail: string;
    recommended?: boolean;
    metadata?: string[];
  }[];
}
/** What one card or row can say about a ticket's work without opening it (S4, S5). */
export interface TaskSummary {
  branch: string | null;
  attempts: number;
  latestAttemptAt: string | null;
  costMicros: number | null;
  costBasis: "priced" | "unpriced" | "none";
  diff: { files: number; additions: number; deletions: number } | null;
  note: string | null;
}
/** A provider's own account of its plan, and the ledger this machine keeps (S6E). */
export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}
export interface UsageProvider {
  id: "claude" | "codex" | "anthropic";
  name: string;
  role: string | null;
  plan: string | null;
  windows: UsageWindow[] | null;
  detail: string;
}
export interface UsageLedger {
  month: string;
  spentMicros: number;
  pricedAttempts: number;
  unpricedAttempts: number;
  ticketsRun: number;
  ticketsMerged: number;
  stoppedAtCeiling: number;
  averageMergedMicros: number | null;
}
export interface UsageReport {
  readAt: string;
  ledger: UsageLedger;
  providers: UsageProvider[];
  notes: string[];
}
export interface ReplyMap {
  repositorySnapshot: RepositorySnapshot;
  snapshot: Snapshot;
  editingOpen: EditingSession;
  editingRead: EditingSession;
  editingSave: EditingSession;
  editingSubmit: EditingSession;
  editingStop: EditingSession;
  editingDiscard: EditingSession;
  openHelp: null;
  chooseRepository: Repository | null;
  forgetRepository: null;
  saveSettings: Settings;
  providers: Provider[];
  login: null;
  models: ModelCatalog;
  usage: UsageReport;
  detail: Detail;
  taskSummary: TaskSummary;
  output: { transcript: string | null; diff: string | null; notes: string[] };
  exportArchive: string | null;
  manifest: { digest: string; value: ManifestEditor; testCommand: string };
  saveManifest: null;
  rename: null;
  archive: null;
  discard: null;
  doctor: Job;
  draft: Job;
  admit: Job;
  edit: Job;
  run: Job;
  sync: Job;
  principle: Job;
  decide: Job;
  verdict: Job;
  cancel: null;
  openRepository: null;
  openWorktree: null;
  openPullRequest: null;
  export: string | null;
}
export interface DesktopBridge {
  request<T extends Request>(request: T): Promise<ReplyMap[T["kind"]]>;
  subscribe(listener: (change: Change) => void): () => void;
  beforeClose?(listener: () => Promise<void>): () => void;
}
export type Response =
  | { ok: true; value: unknown }
  | { ok: false; error: string };
export const CHANNEL = "focrux:request";
export const CHANGED = "focrux:changed";
export const CLOSE_REQUEST = "focrux:close-request";
export const CLOSE_RESPONSE = "focrux:close-response";
export const CLOSE_CANCEL = "focrux:close-cancel";
export const CloseResponseSchema = z.strictObject({ token: identifier, ok: z.boolean(), error: z.string().max(2000).nullable() });
declare global {
  interface Window {
    focrux?: DesktopBridge;
  }
}
