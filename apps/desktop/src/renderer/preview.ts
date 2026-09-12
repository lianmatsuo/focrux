import { HELP_LINKS, EditingSessionSchema, RequestSchema, TaskModelsSchema } from "../shared/protocol.js";
import { ContractEditing, type EditingOwner } from "../shared/contract-editing.js";
import { archiveCsv, archiveRows } from "../shared/archive.js";
import type { PlanContract, ReviewArtifact, Ticket } from "@focrux/contracts";
import { SettingsSchema } from "../shared/protocol.js";
import type {
  DesktopBridge,
  Detail,
  Draft,
  Job,
  ManifestEditor,
  ReplyMap,
  Request,
  Snapshot,
  TaskRow,
  TaskSummary,
  Change,
  ChangeInput,
} from "../shared/protocol.js";

/** The supplied mockup's records, isolated behind the browser-only bridge.
 * No native process, credential, repository or network operation is available here.
 * The same screens and transitions render native records in Electron.
 */
const repoId = "80000000-0000-4000-8000-000000000001";
const landingId = "80000000-0000-4000-8000-000000000002";
const at = "2026-09-08T09:40:00.000Z";
const base = "a1b2c3d" + "0".repeat(33);
const plans = new Map<string, PlanContract>(),
  approved = new Set<string>(),
  decisionsAnswered = new Set<string>();
const criteriaText = [
  "A signup POST queues exactly one activation email.",
  "No email is sent for a duplicate signup inside five minutes.",
  "A send failure is retried three times, then dead-lettered.",
];
const activationOutcome =
  "New users receive an activation email within 60 seconds of signing up.";
let next = 422;
function sample(number: number, title: string, state: Ticket["state"]): Ticket {
  const key = "FCX-" + number;
  const contract = {
    plan_id: "plan_preview_" + number,
    version: 1,
    ticket_id: "tkt_preview_" + number,
    level: "P1",
    outcome: activationOutcome,
    acceptance_criteria: criteriaText.map((text, index) => ({
      id: "AC-" + (index + 1),
      text,
      expected_verification: { kind: "test", assertion: text },
    })),
    scope: {
      repository_id: "example/webstore",
      paths_allowed: ["packages/auth/**", "packages/queue/**"],
      paths_prohibited: [".github/workflows/**", "infra/**", "**/*.env*"],
      generated_paths: [],
      expansion_budget_files: 3,
    },
    base: {
      base_commit: base,
      context_manifest_hash: "b".repeat(64),
      captured_at: at,
    },
  } as unknown as PlanContract;
  plans.set(key, contract);
  if (state === "pr_open" || state === "merged") approved.add(key);
  return {
    schema_version: 1,
    ticket_id: contract.ticket_id,
    key,
    title,
    state,
    priority: "normal",
    labels: [],
    depends_on: [],
    source: {
      kind: "none",
      reference: null,
      url: null,
      title_at_admission: null,
    },
    repository_root: "/sample/webstore",
    plan_id: contract.plan_id,
    plan_version: 1,
    approved_at: state === "plan_review" ? null : at,
    admitted_at: at,
    updated_at: at,
    admission: { elapsed_ms: 100, criteria_source: "typed", criteria_count: 3 },
    delivery: {
      state:
        state === "merged"
          ? "merged"
          : state === "closed"
            ? "closed"
            : state === "pr_open"
              ? "open"
              : "none",
      pull_request_url: ["pr_open", "merged", "closed"].includes(state)
        ? "https://github.com/example/webstore/pull/418"
        : null,
      pull_request_number: ["pr_open", "merged", "closed"].includes(state)
        ? 418
        : null,
      observed_at: at,
      branch: "retry-activation-email",
    },
    history: [],
  } as unknown as Ticket;
}
function row(
  number: number,
  title: string,
  state: Ticket["state"],
  summary: TaskRow["summary"],
): TaskRow {
  return {
    repoId,
    repository: "webstore",
    ticket: sample(number, title, state),
    ...(summary ? { summary } : {}),
  };
}
const home = [
  row(412, "Activation email never sent on signup", "changes_requested", {
    created: "22 min ago",
    stage: 4,
    description:
      "Activation mail is queued but never sent for a fresh signup. One decision is waiting: where a permanently failed send should be retained.",
  }),
  row(377, "Backfill the audit table", "pr_open", {
    created: "yesterday",
    stage: 6,
    description:
      "Both loops finished and the reviewer approved. 3 of 3 criteria directly verified — the merge is the only thing left, and it is yours.",
  }),
  row(398, "Rate-limit the invite endpoint", "executing", {
    created: "1h ago",
    stage: 2,
    description:
      "Editing packages/api/invite.ts — step 3 of the agent’s own plan.",
    progress: 58,
    elapsed: "4m 12s",
    cost: "$0.61",
    files: 6,
  }),
  row(404, "Cache the pricing table response", "verifying", {
    created: "2h ago",
    stage: 3,
    description:
      "Running typecheck, lint and 184 tests on the sealed change set. Nothing needed from you unless one of them fails.",
  }),
  row(421, "Split the settings page into tabs", "plan_review", {
    created: "3h ago",
    stage: 1,
    description:
      "Criteria drafted and the contract is compiled, waiting for your approval before the loop starts.",
  }),
];
home.forEach((row, index) => {
  row.ticket.updated_at = new Date(Date.parse(at) - index * 1000).toISOString();
});
const archived = [
  [
    409,
    "Retry the webhook dispatcher three times",
    4,
    4,
    "$2.14",
    "#418 · 2 Sep",
    "webstore",
  ],
  [
    402,
    "Reject signups with a plus-addressed duplicate",
    3,
    3,
    "$0.91",
    "#411 · 31 Aug",
    "webstore",
  ],
  [
    396,
    "Show runway on the billing page",
    2,
    3,
    "$3.40",
    "closed unmerged",
    "landing",
  ],
  [
    390,
    "Move session cookies to the shared domain",
    2,
    2,
    "$0.62",
    "#399 · 28 Aug",
    "webstore",
  ],
  [
    385,
    "Dead-letter the invoice sync job",
    3,
    3,
    "$1.77",
    "#394 · 26 Aug",
    "webstore",
  ],
  [
    381,
    "Debounce the search-as-you-type request",
    2,
    2,
    "$0.48",
    "#388 · 24 Aug",
    "landing",
  ],
  [
    374,
    "Expire password reset links after an hour",
    3,
    3,
    "$0.83",
    "#379 · 21 Aug",
    "webstore",
  ],
  [
    366,
    "Paginate the members table",
    2,
    2,
    "$1.12",
    "#371 · 19 Aug",
    "webstore",
  ],
  [
    359,
    "Stop double-charging annual upgrades",
    4,
    4,
    "$2.86",
    "#364 · 16 Aug",
    "webstore",
  ],
  [
    352,
    "Log webhook retries with a request id",
    2,
    2,
    "$0.54",
    "#357 · 14 Aug",
    "landing",
  ],
] as const;
const archive: TaskRow[] = archived.map(
  ([number, title, met, total, cost, delivery, repository], index) => {
    const result = row(
      number,
      title,
      delivery === "closed unmerged" ? "closed" : "merged",
      { criteriaMet: met, criteriaTotal: total, cost, delivery },
    );
    result.repoId = repository === "landing" ? landingId : repoId;
    result.repository = repository;
    result.ticket.updated_at = new Date(
      Date.parse(at) - (index + 1) * 86_400_000,
    ).toISOString();
    return result;
  },
);
for (let i = 0; i < 118; i++) {
  const result = row(300 - i, "Sample archived task " + (i + 11), "merged", {
    criteriaMet: 2,
    criteriaTotal: 2,
    cost: "$1.00",
    delivery: "sample",
  });
  result.ticket.updated_at = new Date(
    Date.parse(at) - (i + 11) * 86_400_000,
  ).toISOString();
  archive.push(result);
}
const initial: Snapshot = {
  mode: "preview",
  version: "0.1.0",
  settings: SettingsSchema.parse({
    name: "Lian",
    onboardingComplete: true,
    executorModel: "sonnet-class",
    reviewerProvider: "codex-cli",
    reviewerModel: "o-class",
    minutes: 12,
    commands: 40,
    ticketDollars: 2.5,
  }),
  repositories: [
    {
      id: repoId,
      name: "example/webstore",
      path: "~/code/webstore",
      branch: "main",
      head: base,
      dirty: false,
      configured: true,
      error: null,
      testCommand: "pnpm test",
      manifestCount: 3,
      prohibitedPaths: [".github/**", "infra/**", "**/*.env*"],
    },
    {
      id: landingId,
      name: "example/landing",
      path: "~/code/landing",
      branch: "main",
      head: "9f0e1a2" + "0".repeat(33),
      dirty: false,
      configured: false,
      error: null,
    },
  ],
  tasks: [...home, ...archive],
  jobs: [],
  errors: [],
  titles: {},
  taskModels: {},
  // Every sample ticket that finished before today is filed; #409 stays on Home in green until it is archived by hand (S4).
  archived: archive.filter((row) => row.ticket.key !== "FCX-409").map((row) => row.repoId + ":" + row.ticket.key),
  power: { holding: false, detail: null, since: null },
};
/** The boards' branch and diff figures, per sample ticket; everything else gets a small deterministic diff. */
const sampleDiffs: Record<string, [string, number, number, number]> = {
  "FCX-412": ["focrux/412-activation-mail", 4, 148, 22],
  "FCX-377": ["focrux/377-audit-backfill", 5, 96, 14],
  "FCX-409": ["focrux/409-webhook-retry", 3, 72, 19],
  "FCX-398": ["focrux/398-invite-ratelimit", 6, 61, 8],
  "FCX-404": ["focrux/404-pricing-cache", 3, 40, 6],
  "FCX-402": ["focrux/402-plus-duplicates", 2, 38, 11],
  "FCX-396": ["focrux/396-billing-runway", 7, 120, 64],
  "FCX-390": ["focrux/390-shared-cookie", 2, 27, 9],
  "FCX-385": ["focrux/385-invoice-dead-letter", 3, 54, 6],
  "FCX-381": ["focrux/381-search-debounce", 1, 16, 3],
  "FCX-374": ["focrux/374-reset-expiry", 4, 88, 41],
  "FCX-366": ["focrux/366-members-paging", 2, 31, 12],
  "FCX-359": ["focrux/359-annual-double-charge", 6, 205, 77],
  "FCX-352": ["focrux/352-onboarding-copy", 1, 9, 2],
};
function sampleSummary(key: string): TaskSummary {
  const row = snapshot.tasks.find((entry) => entry.ticket.key === key);
  if (!row) throw new Error("Sample task not found.");
  const known = sampleDiffs[key];
  const number = Number(key.replace(/^FCX-/, ""));
  if (row.ticket.state === "plan_review" || row.ticket.state === "ready")
    return { branch: null, attempts: 0, latestAttemptAt: null, costMicros: null, costBasis: "none", diff: null, note: null };
  return {
    branch: known?.[0] ?? `focrux/${number}-sample`,
    attempts: 1,
    latestAttemptAt: row.ticket.updated_at,
    costMicros: row.summary?.cost ? Math.round(Number(row.summary.cost.replace("$", "")) * 1_000_000) : 610_000,
    costBasis: "priced",
    diff: known
      ? { files: known[1], additions: known[2], deletions: known[3] }
      : { files: 2, additions: 20 + (number % 7), deletions: 4 + (number % 3) },
    note: null,
  };
}
const snapshot: Snapshot = new URLSearchParams(location.search).has("empty")
  ? {
      ...initial,
      settings: SettingsSchema.parse({}),
      repositories: [],
      tasks: [],
      archived: [],
    }
  : initial;
const sampleManifests = new Map<
  string,
  {
    digest: string;
    value: {
      entries: ManifestEditor["entries"];
      offLimits: string[];
    };
    testCommand: string;
  }
>();
const listeners = new Set<(change: Change) => void>();
const emit = (input: ChangeInput = { kind: "records", repoId: null, key: null }): void => {
  snapshot.sequence = (snapshot.sequence ?? 0) + 1;
  const change = { ...input, sequence: snapshot.sequence };
  for (const listener of listeners) listener(structuredClone(change));
};
function ticketRow(key: string): TaskRow {
  const row = snapshot.tasks.find((row) => row.ticket.key === key);
  if (!row) throw new Error("Sample task not found.");
  return row;
}
function applyDraft(ticket: Ticket, draft: Draft): void {
  const plan = plans.get(ticket.key)!;
  plan.outcome = draft.outcome;
  plan.scope.paths_allowed = draft.paths;
  if ("acceptance_criteria" in plan)
    plan.acceptance_criteria = draft.criteria.map((criterion, index) => ({
      id: "AC-" + (index + 1),
      text: criterion.text,
      expected_verification: {
        kind: criterion.kind,
        assertion: criterion.assertion,
      },
    }));
  ticket.admission.criteria_count = draft.criteria.length;
}
function reviewFor(key: string): ReviewArtifact {
  const isApproved = approved.has(key),
    plan = plans.get(key)!,
    criteria = "acceptance_criteria" in plan ? plan.acceptance_criteria : [];
  return {
    review_id: "rev_preview",
    created_at: at,
    target: { base_commit: base, head_commit: "c".repeat(40) },
    decision: isApproved ? "approve" : "escalate",
    coverage: criteria.map((criterion, index) => ({
      criterion_id: criterion.id,
      status: isApproved || index !== 2 ? "met" : "cannot_determine",
      verification_strength:
        isApproved || index !== 2 ? "directly_verified" : "asserted_only",
      evidence: {
        assertion: criterion.expected_verification.assertion,
        location: {
          file: index === 2 ? "queue/retry.test.ts" : "auth/signup.test.ts",
          line: [142, 171, 88][index] ?? 42,
        },
        ref: "unit",
      },
      note: null,
    })),
    findings: isApproved
      ? []
      : [
          {
            key: "d".repeat(64),
            rule_id: "product.dead_letter",
            severity: "major",
            routing: "escalates",
            status: "open",
            blocking: true,
            blocking_reason: "Criterion 03 leaves a product choice unresolved.",
            closure: "human",
            direction: "positive",
            file: "packages/queue/retry.ts",
            line: 67,
            statement: "Where should a permanently failed email go?",
          },
        ],
  } as unknown as ReviewArtifact;
}
function detail(key: string): Detail {
  const { ticket } = ticketRow(key),
    contract = plans.get(key)!;
  const isApproved = approved.has(key),
    waiting = !isApproved && ticket.state === "changes_requested";
  const sample: NonNullable<Detail["sample"]> = {
    progress: waiting ? 52 : 38,
    stage: waiting ? 4 : ticket.state === "verifying" ? 3 : 2,
    current: "Editing packages/queue/retry.ts",
    elapsed: "21m",
    steps: [
      {
        text: "Worktree materialised from a1b2c3d with 3 manifest files",
        time: "39s",
        state: "complete",
      },
      {
        text: "Read packages/queue — found the webhook failure table",
        time: "1m 04s",
        state: "complete",
      },
      {
        text: "Wrote the retry path in auth/signup.ts",
        time: "2m 11s",
        state: "complete",
      },
      {
        text: "Editing queue/retry.ts — dead-letter behaviour",
        time: "now",
        state: "current",
      },
      {
        text: "Run pnpm test, typecheck, lint and the scope ledger",
        time: "queued",
        state: "queued",
      },
      {
        text: "Hand the sealed change set to the reviewer",
        time: "queued",
        state: "queued",
      },
    ],
    decisions: waiting
      ? [
          {
            id: "dead-letter",
            title: "Where should a permanently failed email go?",
            context:
              "Criterion 03 says “dead-lettered”. The queue has no dead-letter table, so this changes the shape of the diff rather than a line of it.",
            options: [
              {
                title: "A new dead_letters table",
                detail:
                  "Matches how packages/queue already stores webhook failures, so the reviewer can check it against tests that exist.",
                recommended: true,
                metadata: ["+1 migration", "reversible", "~2 min more"],
              },
              {
                title: "A status column on the existing table",
                detail:
                  "Smaller diff. Failures then compete with live rows for the same index.",
              },
              {
                title: "Log it and drop it",
                detail:
                  "Cheapest. Criterion 03 becomes provable only by a log assertion — marked asserted_only.",
              },
            ],
          },
          {
            id: "retention",
            title: "How long should a dead-lettered row be kept?",
            context:
              "Choose how long failed deliveries remain available for inspection.",
            options: [
              {
                title: "30 days, then a scheduled purge",
                detail:
                  "Keeps recent failures available without growing the table forever.",
                recommended: true,
              },
              {
                title: "Keep rows until manually removed",
                detail: "Retains every failure for investigation.",
              },
            ],
          },
          {
            id: "retry",
            title: "Should the retry delay be configurable?",
            context: "Choose the behaviour to ship with this change.",
            options: [
              {
                title: "Hard-code 30s for now, note it in the PR",
                detail: "Keep the first version simple.",
                recommended: true,
              },
              {
                title: "Make the delay configurable",
                detail: "Expose the retry delay as a setting.",
              },
            ],
          },
        ]
      : [],
    transcript: [
      {
        author: "Executor",
        label: "plan · 2m 04s",
        text: "The queue stores webhook failures in webhook_failures, keyed by delivery. Activation mail has no equivalent, so criterion 03 has nowhere to record a permanent failure. Two shapes are possible: reuse that table’s shape for a new one, or widen the existing queue row.",
      },
      {
        author: "Executor",
        label: "decision raised · 4m 12s",
        text: "This is a choice the contract does not settle, and it changes the shape of the diff rather than a line of it. Pausing to ask instead of picking for you.",
      },
      {
        author: "Executor",
        label: "resume · 5m 52s",
        text: "Answer received: a new dead_letters table. Writing the migration first, then the terminal branch.",
      },
      {
        author: "Reviewer",
        label: "review · 11m 08s",
        text: "I have the diff, the three criteria and the check output. I do not have the executor’s account of what it did, by design.",
      },
      {
        author: "Reviewer",
        label: "finding · 11m 40s",
        text: "Criterion 03 is proven by queue/retry.test.ts:88, which never ran — describe.skip is still in the file. 184 tests passed and not one of them touched retry behaviour. Marking it asserted_only and returning it to the executor.",
      },
    ],
    terminal:
      "$ pnpm test --filter queue\nRUN v2.1.4 /worktrees/ayo_wt_2\n✓ auth/signup.test.ts (2 tests) 412ms\n✓ queue/retry.test.ts (3 tests) 388ms\nTest Files 12 passed (12)\n     Tests 186 passed (186)",
  };
  return {
    ticket,
    contract,
    digest: String(ticket.plan_version).repeat(64),
    attempts:
      ticket.state === "plan_review"
        ? []
        : [
            {
              id: "preview-attempt-" + key,
              run: 1,
              round: 0,
              startedAt: at,
              outcome: isApproved ? "approve" : "escalate",
              termination: "Sample attempt complete",
              model: "sonnet-class",
              costMicros: isApproved ? 1940000 : 610000,
              costBasis: "sample",
              partial: false,
              ceilings: [
                {
                  resource: "attempt_commands",
                  used: 23,
                  ceiling: 40,
                  hit: false,
                },
              ],
              review: reviewFor(key),
              reviewDecision: isApproved ? "approve" : "escalate",
              changes: [
                {
                  path: "queue/retry.ts",
                  change_kind: "modified",
                  additions: 64,
                  deletions: 9,
                },
                {
                  path: "queue/dead_letters.sql",
                  change_kind: "added",
                  additions: 31,
                  deletions: 0,
                },
                {
                  path: "auth/signup.ts",
                  change_kind: "modified",
                  additions: 18,
                  deletions: 4,
                },
                {
                  path: "queue/retry.test.ts",
                  change_kind: "modified",
                  additions: 52,
                  deletions: 1,
                },
              ],
              checks: [
                {
                  name: "Typecheck",
                  status: "passed",
                  detail: "Sample result",
                },
                { name: "Lint", status: "passed", detail: "Sample result" },
                {
                  name: "Tests",
                  status: "passed",
                  detail: "186 passed · sample",
                },
              ],
              verification: null,
              bundles: [],
            },
          ],
    cost: {
      micros:
        ticket.state === "plan_review" ? 0 : isApproved ? 1940000 : 610000,
      partial: false,
      unavailable: 0,
    },
    principles: "",
    verdicts: [],
    effective: { minutes: 12, commands: 40, ticketDollars: 2.5 },
    report: { sample: true },
    sample,
  };
}
function job(
  kind: string,
  repository: string,
  key: string | null,
  operation: (job: Job) => void,
  delay = 1000,
  owner?: EditingOwner,
): Job {
  if (snapshot.jobs.some((entry) => ["running", "stopping"].includes(entry.state)))
    throw new Error("Another command is active. Wait for it to finish or stop it before starting this one.");
  const job: Job = {
    id: crypto.randomUUID(),
    repoId: repository,
    key,
    kind,
    label:
      kind === "draft"
        ? "Reading the repository and drafting criteria"
        : kind === "run" || kind === "decide"
          ? "Run engineering loop"
          : "Compiling the contract",
    state: "running",
    startedAt: new Date().toISOString(),
    endedAt: null,
    log: "Interactive sample. No CLI or repository is accessed.",
    error: null,
    resultKey: null,
    result: null,
    ...(owner ? { editing: owner } : {}),
  };
  snapshot.jobs = [...snapshot.jobs.slice(-39), job];
  if (owner) editing.started(owner, job);
  emit({ kind: "progress", job });
  setTimeout(
    () => {
      if (job.state !== "running") return;
      try {
        operation(job);
        job.state = "completed";
      } catch (error) {
        job.state = "failed";
        job.error = String(error instanceof Error ? error.message : error);
      }
      job.endedAt = new Date().toISOString();
      void editing.settled(job).catch((error: unknown) => {
        job.error = String(error);
        job.state = "failed";
      }).finally(() => emit({ kind: "records", repoId: repository, key: job.resultKey ?? key, job }));
    },
    new URLSearchParams(location.search).has("slow") ? 8000 : delay,
  );
  return job;
}
const editing = new ContractEditing({
  records: () => EditingSessionSchema.array().parse(JSON.parse(localStorage.getItem("focrux:preview-editing") ?? "[]")),
  persist: (records) => {
    const previous = EditingSessionSchema.array().parse(JSON.parse(localStorage.getItem("focrux:preview-editing") ?? "[]"));
    localStorage.setItem("focrux:preview-editing", JSON.stringify(records));
    for (const record of records) if (JSON.stringify(previous.find((entry) => entry.id === record.id)) !== JSON.stringify(record)) emit({ kind: "editing", sessionId: record.id });
  },
  repository: (id) => {
    if (!snapshot.repositories.some((repo) => repo.id === id)) throw new Error("This sample repository is no longer connected.");
  },
  defaults: (repoId, key) => TaskModelsSchema.strip().parse(snapshot.taskModels?.[repoId + ":" + key] ?? snapshot.settings),
  detail: async (repoId, key) => {
    if (!snapshot.tasks.some((row) => row.repoId === repoId && row.ticket.key === key)) throw new Error("Sample task not found in this repository.");
    return structuredClone(detail(key));
  },
  start: (request, owner) => previewRequest(request, owner),
  stop: async (jobId) => { await previewRequest({ kind: "cancel", jobId }); },
  id: () => crypto.randomUUID(),
});
editing.recover();

async function previewRequest<T extends Request>(request: T, owner?: EditingOwner): Promise<ReplyMap[T["kind"]]> {
    let result: unknown = null;
    switch (request.kind) {
      case "editingOpen": result = await editing.open(request.target, request.legacy); break;
      case "editingRead": result = editing.read(request.id); break;
      case "editingSave": result = editing.save(request.id, request.revision, request.repoId, request.form); break;
      case "editingSubmit": result = await editing.submit(request.id, request.revision, request.operationId, request.intent); break;
      case "editingStop": result = await editing.stop(request.id); break;
      case "editingDiscard": result = editing.discard(request.id, request.revision); break;
      case "login":
        throw new Error("This is a sample workspace. The desktop app opens your terminal on the provider's sign-in command.");
      case "openHelp":
        window.open(HELP_LINKS[request.page], "_blank", "noopener");
        break;
      case "snapshot":
        result = structuredClone(snapshot);
        break;
      case "repositorySnapshot": {
        const repository = snapshot.repositories.find((entry) => entry.id === request.repoId);
        if (!repository) throw new Error("This sample repository is no longer connected.");
        result = structuredClone({ repository, tasks: snapshot.tasks.filter((entry) => entry.repoId === request.repoId), errors: [] });
        break;
      }
      case "detail":
        if (!snapshot.tasks.some((row) => row.repoId === request.repoId && row.ticket.key === request.key)) throw new Error("Sample task not found in this repository.");
        result = detail(request.key);
        break;
      case "manifest":
        result = structuredClone(
          sampleManifests.get(request.repoId) ?? {
            digest: "1".repeat(64),
            testCommand: "pnpm test",
            value: {
              offLimits: [".github/**", "infra/**", "**/*.env*"],
              entries: [
                ".env.local",
                ".certs/dev.pem",
                "fixtures/seed.json",
              ].map((path) => ({
                path,
                source_path: path,
                kind: "file" as const,
                strategy: "copy" as const,
                secret: true,
                required: true,
                reason: "Sample local setup",
              })),
            },
          },
        );
        break;
      case "saveManifest":
        sampleManifests.set(request.repoId, {
          digest: "2".repeat(64),
          value: request.value,
          testCommand: "pnpm test",
        });
        snapshot.repositories = snapshot.repositories.map((repo) =>
          repo.id === request.repoId
            ? {
                ...repo,
                manifestCount: request.value.entries.length,
                prohibitedPaths: request.value.offLimits,
              }
            : repo,
        );
        emit();
        break;
      case "models":
        result = {
          provider: request.provider,
          source: "sample",
          discoveredAt: new Date().toISOString(),
          models: (request.provider === "codex-cli"
            ? [
                ["o-class", "O-class", "Sample reviewer"],
                ["codex-sample", "Codex sample", "Sample coding model"],
              ]
            : [
                ["sonnet-class", "Sonnet-class", "Sample executor"],
                ["opus-sample", "Opus sample", "Sample reasoning model"],
              ]
          ).map(([id, label, description], index) => ({
            id,
            label,
            description,
            isDefault: index === 0,
          })),
        };
        break;
      case "providers":
        result = [
          {
            id: "claude",
            name: "Claude Code",
            installed: true,
            authenticated: true,
            detail: "Sample connection · subscription CLI",
            loginCommand: "claude auth login",
            roles: ["Execution", "Independent review", "Planning"],
          },
          {
            id: "codex",
            name: "Codex",
            installed: true,
            authenticated: true,
            detail: "Sample connection · subscription CLI",
            loginCommand: "codex login",
            roles: ["Execution", "Independent review", "Planning"],
          },
        ];
        break;
      case "saveSettings":
        snapshot.settings = request.settings;
        result = request.settings;
        emit({ kind: "preferences", settings: snapshot.settings, titles: snapshot.titles ?? {}, taskModels: snapshot.taskModels ?? {}, archived: snapshot.archived ?? [] });
        break;
      case "archive": {
        const entries = request.keys.map((key) => request.repoId + ":" + ticketRow(key).ticket.key);
        snapshot.archived = request.archived
          ? [...new Set([...(snapshot.archived ?? []), ...entries])]
          : (snapshot.archived ?? []).filter((entry) => !entries.includes(entry));
        emit({ kind: "preferences", settings: snapshot.settings, titles: snapshot.titles ?? {}, taskModels: snapshot.taskModels ?? {}, archived: snapshot.archived });
        break;
      }
      case "discard": {
        const row = ticketRow(request.key);
        if (!["draft", "specifying", "plan_review", "ready", "plan_invalid"].includes(row.ticket.state))
          throw new Error("Only a contract that has never run can be deleted. This one has moved past the contract stage.");
        snapshot.tasks = snapshot.tasks.filter((entry) => entry !== row);
        plans.delete(request.key);
        emit({ kind: "records", repoId: request.repoId, key: null });
        break;
      }
      case "taskSummary":
        if (!snapshot.tasks.some((row) => row.repoId === request.repoId && row.ticket.key === request.key)) throw new Error("Sample task not found in this repository.");
        result = sampleSummary(request.key);
        break;
      case "usage":
        // The boards' figures, labelled as a sample by the preview indicator; the desktop reads its own records.
        result = {
          readAt: new Date().toISOString(),
          ledger: { month: new Date().toISOString().slice(0, 7), spentMicros: 24_500_000, pricedAttempts: 41, unpricedAttempts: 0, ticketsRun: 34, ticketsMerged: 18, stoppedAtCeiling: 2, averageMergedMicros: 1_380_000 },
          providers: [
            { id: "claude", name: "Claude Code", role: "default executor", plan: "Max · 20×", detail: "Sample plan · read from the provider's reply", windows: [
              { label: "Session · 5-hour window", usedPercent: 78, resetsAt: new Date(Date.now() + 108 * 60_000).toISOString() },
              { label: "Weekly · all models", usedPercent: 41, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
              { label: "Weekly · opus-class", usedPercent: 12, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
            ] },
            { id: "codex", name: "Codex", role: "default reviewer", plan: "Pro", detail: "Sample plan · read from the provider's reply", windows: [
              { label: "Session · 5-hour window", usedPercent: 23, resetsAt: new Date(Date.now() + 133 * 60_000).toISOString() },
              { label: "Weekly · all models", usedPercent: 18, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
            ] },
            { id: "anthropic", name: "Anthropic API", role: null, plan: null, windows: null, detail: "No API key on this machine, so there is no plan to report." },
          ],
          notes: [],
        };
        break;
      case "rename":
        snapshot.titles = {
          ...snapshot.titles,
          [request.repoId + ":" + request.key]: request.title,
        };
        emit({ kind: "preferences", settings: snapshot.settings, titles: snapshot.titles ?? {}, taskModels: snapshot.taskModels ?? {}, archived: snapshot.archived ?? [] });
        break;
      case "chooseRepository":
        if (!snapshot.repositories.length)
          snapshot.repositories = [...initial.repositories];
        result = snapshot.repositories[0];
        emit({ kind: "repositories" });
        break;
      case "forgetRepository":
        snapshot.repositories = snapshot.repositories.filter(
          (repo) => repo.id !== request.repoId,
        );
        snapshot.tasks = snapshot.tasks.filter(
          (row) => row.repoId !== request.repoId,
        );
        emit();
        break;
      case "doctor":
        result = job("doctor", request.repoId, null, (job) => {
          const repo = snapshot.repositories.find(
            (repo) => repo.id === request.repoId,
          )!;
          if (request.writeConfig) repo.configured = true;
          job.log =
            "Sample readiness check\n✓ Git checkout available\n✓ pnpm test detected\n✓ Worktree preparation available\n3 manifest files selected";
        });
        break;
      case "draft":
      case "admit":
        result = job(
          request.kind,
          request.repoId,
          null,
          (job) => {
            const ticket = sample(
              next++,
              request.kind === "draft"
                ? "Activation email never sent on signup"
                : request.draft.outcome,
              "plan_review",
            );
            applyDraft(
              ticket,
              request.kind === "draft"
                ? {
                    outcome: request.outcome,
                    criteria: criteriaText.map((text) => ({
                      text,
                      assertion: text,
                      kind: "test",
                    })),
                    paths: ["packages/auth/**", "packages/queue/**"],
                  }
                : request.draft,
            );
            snapshot.tasks.push({
              repoId: request.repoId,
              repository: "webstore",
              ticket,
            });
            if (request.models) {
              snapshot.taskModels = {
                ...snapshot.taskModels,
                [request.repoId + ":" + ticket.key]: request.models,
              };
              emit({ kind: "preferences", settings: snapshot.settings, titles: snapshot.titles ?? {}, taskModels: snapshot.taskModels, archived: snapshot.archived ?? [] });
            }
            job.resultKey = ticket.key;
          },
          request.kind === "draft" ? 2200 : 1100,
          owner,
        );
        break;
      case "edit":
        result = job("edit", request.repoId, request.key, (job) => {
          const { ticket } = ticketRow(request.key);
          if (!snapshot.tasks.some((row) => row.repoId === request.repoId && row.ticket.key === request.key)) throw new Error("Sample task not found in this repository.");
          if (ticket.approved_at) throw new Error("An approved contract cannot be edited.");
          if (detail(request.key).digest !== request.digest) throw new Error("The contract changed since you viewed it.");
          applyDraft(ticket, request.draft);
          ticket.plan_version += 1;
          if (request.models) {
            snapshot.taskModels = {
              ...snapshot.taskModels,
              [request.repoId + ":" + ticket.key]: request.models,
            };
            emit({ kind: "preferences", settings: snapshot.settings, titles: snapshot.titles ?? {}, taskModels: snapshot.taskModels, archived: snapshot.archived ?? [] });
          }
          job.resultKey = request.key;
        }, 1000, owner);
        break;
      case "run":
      case "decide": {
        const row = ticketRow(request.key);
        row.ticket.approved_at = at;
        row.ticket.state = "executing";
        delete row.summary;
        if (request.kind === "decide") decisionsAnswered.add(request.key);
        result = job(
          request.kind,
          request.repoId,
          request.key,
          () => {
            if (!decisionsAnswered.has(request.key))
              row.ticket.state = "changes_requested";
            else {
              row.ticket.state = "pr_open";
              row.ticket.delivery.state = "open";
              row.ticket.delivery.pull_request_number = 418;
              row.ticket.delivery.pull_request_url =
                "https://github.com/example/webstore/pull/418";
              approved.add(request.key);
            }
          },
          2600,
        );
        break;
      }
      case "principle":
      case "verdict":
        result = job(request.kind, request.repoId, request.key, () => {
          decisionsAnswered.add(request.key);
        });
        break;
      case "cancel": {
        const active = snapshot.jobs.find((job) => job.id === request.jobId);
        if (active) {
          active.state = "cancelled";
          active.endedAt = new Date().toISOString();
          if (active.key && ["run", "decide"].includes(active.kind)) ticketRow(active.key).ticket.state = "cancelled";
          await editing.settled(active);
        }
        if (active) emit({ kind: "records", repoId: active.repoId, key: active.resultKey ?? active.key, job: active });
        break;
      }
      case "sync":
        result = job("sync", request.repoId, request.key, () => {
          const { ticket } = ticketRow(request.key);
          if (ticket.delivery.state === "open") {
            ticket.state = "merged";
            ticket.delivery.state = "merged";
            ticket.delivery.observed_at = new Date().toISOString();
          }
        });
        break;
      case "openPullRequest":
        break; // The UI shows the GitHub handoff; no external site opens in this sandbox.
      case "openWorktree":
      case "openRepository":
        throw new Error(
          "This is a sample repository. The desktop app opens your real folder.",
        );
      case "output":
        if (!snapshot.tasks.some((row) => row.repoId === request.repoId && row.ticket.key === request.key)) throw new Error("Sample task not found in this repository.");
        if (request.attemptId && !detail(request.key).attempts.some((entry) => entry.id === request.attemptId)) throw new Error("The selected attempt does not belong to this task.");
        result = { transcript: null, diff: null, notes: [] };
        break;
      case "exportArchive": {
        result = archiveCsv(archiveRows(snapshot, request), snapshot.titles);
        await navigator.clipboard.writeText(result as string);
        break;
      }
      case "export": {
        const data = request.key
          ? detail(request.key)
          : snapshot.tasks.filter((row) => row.repoId === request.repoId);
        result = JSON.stringify(data, null, 2);
        await navigator.clipboard.writeText(result as string);
        break;
      }
    }
    return result as ReplyMap[T["kind"]];
}
export const previewBridge: DesktopBridge = {
  request: (request) => previewRequest(RequestSchema.parse(request) as typeof request),
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
