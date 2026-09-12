import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  invocationShapeHash,
  type CommandRecord,
  type TerminationReason,
} from "@focrux/contracts";
import {
  DEFAULT_SUSPEND_INTERVAL_MS,
  DEFAULT_SUSPEND_THRESHOLD_MS,
  SuspendDetector,
} from "@focrux/workspace";
import type { AgentRequest, AgentResult } from "./adapter.js";
import { CodexExecutorSession, CODEX_EXECUTOR_ARGV } from "./codex-rpc.js";
import { EgressLog } from "./egress.js";
import { judgeCommand, matchesListEntry } from "./admission.js";
import { judgePreToolCall, type PreToolGuardState } from "./pretool.js";
import { prepareScratchDirectory } from "./scratch.js";

const ChangeSchema = z
  .object({
    path: z.string(),
    kind: z
      .object({ type: z.string(), move_path: z.string().nullable().optional() })
      .passthrough(),
  })
  .passthrough();
const ItemSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    command: z.string().optional(),
    cwd: z.string().optional(),
    text: z.string().optional(),
    changes: z.array(ChangeSchema).optional(),
  })
  .passthrough();
const EventSchema = z.object({ item: ItemSchema.optional() }).passthrough();
const ApprovalSchema = z
  .object({
    itemId: z.string(),
    command: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
    grantRoot: z.string().nullable().optional(),
    additionalPermissions: z.unknown().optional(),
    networkApprovalContext: z.unknown().optional(),
  })
  .passthrough();
type Item = z.infer<typeof ItemSchema>;

/** Inspection only: the native CLI owns execution; model text is never a host action parameter. */
export function codexCommandDecision(
  command: string,
  cwd: string,
  state: PreToolGuardState,
) {
  const rel = relative(state.root, cwd);
  if (
    !isAbsolute(cwd) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  )
    return {
      decision: "denied" as const,
      rule: "write_outside_worktree" as const,
      reason: "Command directory is outside the materialized worktree.",
      target: cwd,
    };
  const guard = { ...state, cwd };
  const { decision } = judgePreToolCall(
    {
      tool_name: "Bash",
      tool_input: { command },
      tool_use_id: "codex-approval",
    },
    guard,
    new Date(),
  );
  if (decision.decision === "denied" || decision.answer === "allow")
    return decision;
  const { inspection } = judgeCommand({
    tool: "Bash",
    detail: command,
    allow_list: state.allow_list,
    deny_list: state.deny_list,
    scope: {
      root: state.root,
      cwd,
      ...(state.tmpdir ? { tmpdir: state.tmpdir } : {}),
      paths_allowed: state.paths_allowed,
    },
  });
  const eligible = (segment: (typeof inspection.segments)[number]): boolean => {
    if (segment.unreadablePrograms.length > 0) return false;
    if (segment.nested.length > 0)
      return segment.accounted && segment.nested.every(eligible);
    return (
      segment.programs.length === 0 ||
      segment.programs.every((program) =>
        [
          "cd",
          "pushd",
          "popd",
          "echo",
          "printf",
          "true",
          "false",
          ":",
        ].includes(program),
      ) ||
      state.allow_list.some((entry) =>
        matchesListEntry(entry, "Bash", segment.text),
      )
    );
  };
  const admitted =
    inspection.segments.length > 0 && inspection.segments.every(eligible);
  return admitted
    ? decision
    : {
        ...decision,
        decision: "denied" as const,
        rule: "command_allow_list" as const,
        reason: "Command is outside the runner's admitted command set.",
        target: command,
      };
}

export function codexFileDecision(path: string, state: PreToolGuardState) {
  const absolute = resolve(state.root, path);
  return judgePreToolCall(
    {
      tool_name: "Write",
      tool_input: { file_path: absolute },
      tool_use_id: "codex-approval",
    },
    state,
    new Date(),
  ).decision;
}

/** Native subscription executor with isolated provider configuration and per-request approval. */
export async function runCodexAgent(
  request: AgentRequest,
): Promise<AgentResult> {
  if (request.supervision === "agent_permissions")
    throw new Error(
      "The direct-agent comparison arm is registered for Claude Code only.",
    );
  const redact = request.redact ?? ((text: string) => text);
  const progress = request.onProgress ?? (() => undefined);
  const state: PreToolGuardState = {
    root: request.worktree,
    cwd: request.worktree,
    tmpdir: prepareScratchDirectory(request.worktree),
    paths_allowed: [...(request.paths_allowed ?? [])],
    allow_list: [...request.profile.command_allow_list],
    deny_list: [...request.profile.command_deny_list],
  };
  const commands: CommandRecord[] = [],
    transcript: string[] = [];
  const items = new Map<string, Item>();
  const records = new Map<string, CommandRecord>();
  const egress = new EgressLog(request.profile.network_allow_list);
  let inputTokens = 0,
    cachedTokens = 0,
    outputTokens = 0,
    countedTokens = 0;
  let finalMessage: string | null = null;
  let termination: { reason: TerminationReason; detail: string } = {
    reason: "agent_error",
    detail: "Codex did not report completion",
  };
  let session: CodexExecutorSession | null = null;
  let stopped = false;
  const stop = (reason: TerminationReason, detail: string): void => {
    if (stopped) return;
    stopped = true;
    termination = { reason, detail: redact(detail) };
    session?.close(new Error(detail));
  };
  const cancel = (): void => stop("cancelled", "Stopped by the user");
  const detector = new SuspendDetector(
    () => stop("host_suspended", "Host suspended during the Codex attempt"),
    DEFAULT_SUSPEND_INTERVAL_MS,
    DEFAULT_SUSPEND_THRESHOLD_MS,
    request.clock ?? Date.now,
  );
  const timer = setInterval(() => {
    const breach = request.ceilings.tick();
    if (breach) stop(breach.reason, breach.detail);
  }, 250);
  const suspend = setInterval(
    () => detector.tick(),
    DEFAULT_SUSPEND_INTERVAL_MS,
  );
  process.on("SIGTERM", cancel);
  process.on("SIGINT", cancel);
  let fingerprint = {
    path: request.binary,
    version: "unknown",
    sha256: "0".repeat(64),
  };
  try {
    const path = execFileSync("which", [request.binary], {
      encoding: "utf8",
    }).trim();
    fingerprint = {
      path,
      version: execFileSync(request.binary, ["--version"], {
        encoding: "utf8",
        timeout: 30_000,
      }).trim(),
      sha256: createHash("sha256")
        .update(readFileSync(realpathSync(path)))
        .digest("hex"),
    };
  } catch {
    /* Unavailable fingerprint is recorded, never invented. Session startup will report a missing binary. */
  }
  let credential: AgentResult["invocation"]["credential_class"] = "unknown";
  const record = (item: Item): CommandRecord => {
    const existing = records.get(item.id);
    if (existing) return existing;
    const breach =
      request.ceilings.noteCommand() ?? request.ceilings.noteIteration();
    if (breach) stop(breach.reason, breach.detail);
    const entry: CommandRecord = {
      sequence: commands.length,
      tool: item.type,
      detail: redact(
        item.command ??
          item.changes?.map((change) => change.path).join(", ") ??
          item.type,
      ),
      decision: "allowed",
      denial_reason: null,
      denial_rule: null,
      denial_target: null,
      cwd: item.cwd ? relative(request.worktree, item.cwd) || "." : ".",
      decided_by: "agent_permission_layer",
      second_reading: null,
      at: new Date().toISOString(),
    };
    commands.push(entry);
    records.set(item.id, entry);
    return entry;
  };
  try {
    session = new CodexExecutorSession({
      binary: request.binary,
      env: request.env,
      worktree: request.worktree,
      timeoutMs: request.ceilings.wallClockLimitMs,
      onUsage: (usage) => {
        inputTokens = usage.inputTokens;
        cachedTokens = usage.cachedInputTokens;
        outputTokens = usage.outputTokens;
        const fresh = Math.max(0, inputTokens - cachedTokens) + outputTokens;
        const breach = request.ceilings.noteTokens(
          Math.max(0, fresh - countedTokens),
        );
        countedTokens = fresh;
        if (breach) stop(breach.reason, breach.detail);
      },
      onEvent: (method, payload) => {
        const parsed = EventSchema.safeParse(payload);
        if (!parsed.success) return;
        const item = parsed.data.item;
        if (method === "model/rerouted") {
          stop("agent_error", "Codex rerouted away from the selected model");
          return;
        }
        if (!item) return;
        items.set(item.id, item);
        if (method === "item/completed")
          transcript.push(
            redact(JSON.stringify({ method, item })).slice(0, 200_000),
          );
        if (item.type === "commandExecution" || item.type === "fileChange") {
          record(item);
          if (
            item.command &&
            egress.observe(item.command, "command", new Date()).length > 0
          )
            stop(
              "unlisted_egress_host",
              "Command requested a host outside the network allow-list",
            );
          if (method === "item/started")
            progress(
              `Codex ${redact(item.command ?? item.changes?.map((change) => change.path).join(", ") ?? item.type).slice(0, 160)}`,
            );
        }
        if (
          [
            "mcpToolCall",
            "dynamicToolCall",
            "collabAgentToolCall",
            "webSearch",
          ].includes(item.type)
        )
          stop(
            "agent_error",
            `Unexpected capability in the isolated Codex session: ${item.type}`,
          );
      },
      approve: (method, payload) => {
        if (stopped) return false;
        const parsed = ApprovalSchema.safeParse(payload);
        if (!parsed.success) return false;
        const requestApproval = parsed.data;
        const item = items.get(requestApproval.itemId);
        // A file approval without the preceding change list cannot be checked safely.
        if (
          method === "item/fileChange/requestApproval" &&
          (!item?.changes?.length || requestApproval.grantRoot)
        )
          return false;
        const observed: Item = item ?? {
          id: requestApproval.itemId,
          type: "commandExecution",
          ...(requestApproval.command
            ? { command: requestApproval.command }
            : {}),
          ...(requestApproval.cwd ? { cwd: requestApproval.cwd } : {}),
        };
        const entry = record(observed);
        const decisions =
          method === "item/fileChange/requestApproval"
            ? item!
                .changes!.flatMap((change) => [
                  change.path,
                  ...(change.kind.move_path ? [change.kind.move_path] : []),
                ])
                .map((path) => codexFileDecision(path, state))
            : [
                codexCommandDecision(
                  requestApproval.command ?? "",
                  requestApproval.cwd ?? "",
                  state,
                ),
              ];
        const denial = decisions.find(
          (decision) => decision.decision === "denied",
        );
        const accepted =
          !stopped &&
          !denial &&
          !requestApproval.additionalPermissions &&
          !requestApproval.networkApprovalContext;
        entry.decided_by = "runner_admission";
        entry.decision = accepted ? "allowed" : "denied";
        entry.denial_reason = accepted
          ? null
          : redact(
              denial?.reason ??
                "Additional permissions and network escalation are not granted by this runner.",
            );
        entry.denial_rule = accepted
          ? null
          : (denial?.rule ?? "command_allow_list");
        entry.denial_target = denial?.target ? redact(denial.target) : null;
        return accepted;
      },
    });
    const thread = await session.start(
      request.model,
      "You are a coding agent implementing an approved software change. Read the relevant files, implement the approved outcome, and run the required checks. The host handles publication and git history. Do not attempt those actions yourself. State the final result and any remaining blockers.",
    );
    credential = session.credentialClass;
    if (!stopped)
      finalMessage = redact(
        await session.turn(thread, request.model, request.prompt),
      );
    if (!stopped) termination = { reason: "completed", detail: "" };
  } catch (error) {
    if (!stopped) {
      const detail = redact(
        error instanceof Error ? error.message : String(error),
      );
      // Only provider protocol failures reach this catch; repository text is never classified here.
      termination = {
        reason:
          /429|5\d\d|rate.limit|usage.limit|connection|timed out|stream disconnected/i.test(
            detail,
          )
            ? "transport_unavailable"
            : "agent_error",
        detail,
      };
    }
  } finally {
    await session?.dispose();
    clearInterval(timer);
    clearInterval(suspend);
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
  return {
    invocation: {
      adapter: "codex",
      binary_path: fingerprint.path,
      binary_version: fingerprint.version,
      binary_sha256: fingerprint.sha256,
      model: request.model,
      credential_class: credential,
      argv: [...CODEX_EXECUTOR_ARGV],
      shape_sha256: invocationShapeHash([...CODEX_EXECUTOR_ARGV], []),
      neutralisation: {
        suppressed_at_invocation: [
          "isolated CODEX_HOME with provider-owned auth link only",
          "read-only native sandbox with per-request approval",
          "default local environment; empty dynamic tools and selected capability roots",
          "OpenAI provider pinned; web search and agents disabled",
        ],
        withheld_from_worktree: [],
        asserted_empty: ["instructionSources"],
        reported: {
          mcp_servers: [],
          plugins: [],
          skills: [],
          subagents: [],
          memory_paths: [],
        },
      },
    },
    commands,
    egress,
    prohibited: [],
    usage: {
      input_tokens: inputTokens,
      cache_read_input_tokens: cachedTokens,
      output_tokens: outputTokens,
      cost_micros: 0,
      cost_basis: "unavailable",
      cost_partial: true,
      iterations: request.ceilings.counts().iterations,
    },
    termination,
    final_message: finalMessage,
    transcript,
  };
}
