import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionProfile } from "@focrux/contracts";
import {
  ADMISSION_RULES,
  judgeCommand,
  matchesListEntry,
  type AdmissionRule,
} from "./admission.js";
import { UNKNOWN_CWD, type CommandSegment } from "./prohibited.js";
import { HOST_TEMPORARY_DIRECTORY } from "./scratch.js";

/**
 * The write guard, moved in front of the tool (SCP-177).
 *
 * `judgeCommand` reads a `tool_use` block out of the stream, which the agent
 * emits **after** the tool has run. That makes admitting a mutating verb by
 * where its paths land impossible to enforce: the runner can refuse a command
 * the outer `--allowedTools` list already admitted, but it cannot admit one the
 * outer list refused without the command running first. AYO-29's executor
 * closed that gap the wrong way, by putting `rm`, `cp`, `mv`, `ln`, `chmod`,
 * `mkdir`, `touch` and `tee` on the enforced list.
 *
 * The mechanism that closes it properly is a `PreToolUse` hook. Claude Code
 * runs it before the tool, hands it the tool name and input on stdin, and obeys
 * the `permissionDecision` it prints — `deny` stops the call and `allow` runs
 * one the allow-list does not carry. Measured against the pinned binary
 * (2.1.247) rather than assumed; the measurement and the rejected alternative
 * are in `docs/08`.
 *
 * ## Why a hook and not the permission-prompt tool
 *
 * `--permission-prompt-tool` works too, and was measured working. It needs an
 * MCP server, and ADR-0030's requirement 3 asserts that **no tool server at
 * all** is connected — the one thing that assertion achieves exactly. Buying a
 * pre-execution decision by weakening threat 18 is the wrong trade when a hook
 * buys the same decision and connects nothing.
 *
 * ## Where the state lives, and why outside the worktree
 *
 * The hook is a separate process, so what it knows it reads from disk: the
 * worktree root, the scratch directory, the lists, and the directory the
 * executor's shell stands in (SCP-170), which the hook advances itself because
 * it is the only reader that sees the calls in the order they execute.
 *
 * That directory is outside the worktree on purpose. Inside it, an executor
 * could rewrite the root and admit itself anywhere; outside it, every write to
 * it is a write outside the worktree, which is the thing this guard refuses.
 * The guard's own state is protected by the guard.
 *
 * The decisions file carries no command text. The runner already holds a
 * redacted `detail` for each call from the stream, and writing a second,
 * unredacted copy of every command to a file outside the worktree would put
 * materialized secrets somewhere the secret index does not reach. Decisions are
 * keyed by `tool_use_id`, which the hook input carries.
 *
 * ## Three answers, not two
 *
 * A hook that answers every call would be the only permission layer, because
 * `allow` bypasses the `--allowedTools` list, the built-in handling and the
 * binary's own write sandbox alike. The runner does not know enough to be that
 * layer: `judgeCommand` authors three refusals — the deny-list, a write the
 * resolver put outside the worktree, and a write it put inside the worktree but
 * outside the globs the contract admits (SCP-195) — and `SCP-163`'s follow-up
 * established why it must not author one more from absence off the allow-list.
 * The agent's own layer admits `pwd`, `test`, `command -v` and the rest of the
 * built-ins with no entry, and a runner that refused them would refuse
 * commands that were always going to run.
 *
 * So the hook answers:
 *
 * - **deny** — the deny-list, a write outside the worktree, or a write inside it
 *   that the contract's globs do not admit. This is the refusal, and it stops
 *   the call.
 * - **allow** — the line runs a verb that writes to a path it names, or a verb
 *   with no effect beyond one already judged, and every target the resolver
 *   found is inside. This is the admission `SCP-163` needs, and it is what
 *   lets `rm -r .scratch` run without `rm` on the enforced list.
 * - **nothing** — the runner has no grounds either way, so the answer is
 *   silence and the agent's own permission layer decides as it always did.
 *   Measured: a hook that prints nothing and exits 0 leaves `ls -la` admitted
 *   under `Bash(ls:*)` and `mkdir` refused under an empty list. That silence is
 *   what keeps `script -q /dev/null …` out — the runner does not vouch for it,
 *   and the outer list does not carry it.
 */

/** The tools the hook is installed for: everything that can write. */
export const PRE_TOOL_JUDGED_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
] as const;

/** The `matcher` a Claude Code hook entry takes: alternation over tool names. */
export const PRE_TOOL_MATCHER = PRE_TOOL_JUDGED_TOOLS.join("|");

/** What the hook needs to judge a call, as the runner writes it. */
export interface PreToolGuardState {
  /** The attempt's worktree root. */
  root: string;
  /** The scratch directory `$TMPDIR` points at, or null where there is none. */
  tmpdir: string | null;
  /** Where the executor's shell stands: absolute, or `UNKNOWN_CWD`. */
  cwd: string;
  /**
   * The globs the approved contract admits a write under, relative to the root
   * (SCP-195). Empty, or carrying `**`, admits everything inside the root.
   */
  paths_allowed: string[];
  allow_list: string[];
  deny_list: string[];
}

/** What the hook told the agent about one call. */
export type PreToolAnswer = "allow" | "deny" | "defer";

/** One decision the hook made, as the runner reads it back. */
export interface PreToolDecision {
  /** The call this answers. The runner joins on it; there is no other key. */
  tool_use_id: string;
  tool: string;
  /**
   * What the hook said. `defer` means it said nothing and the agent's own
   * permission layer decided, so the attempt's record must not claim this
   * decision as the runner's.
   */
  answer: PreToolAnswer;
  decision: "allowed" | "denied";
  rule: AdmissionRule | null;
  /** Unredacted: a path or a command fragment. The runner redacts before recording. */
  target: string | null;
  reason: string | null;
  /** The directory the call was judged from, relative to the root, or `unknown`. */
  cwd: string | null;
  at: string;
}

/** The files the guard keeps for one attempt. */
/**
 * What an invocation needs from whichever settings the runner wrote for it.
 *
 * Two shapes answer to this: the guard below, and the hookless settings
 * SCP-228 gives an agent the runner does not police. The invocation names a
 * settings file either way, because that argument is also what keeps every
 * other hook out (SCP-177).
 */
export interface AgentSettings {
  /** Outside the worktree, so the executor cannot write to it. */
  directory: string;
  /** Passed to the binary as `--settings`. */
  settingsPath: string;
  /** The hook's own decisions; empty and never appended to where none runs. */
  decisionsPath: string;
}

export interface PreToolGuard extends AgentSettings {
  statePath: string;
}

const STATE_FILE = "state.json";
const DECISIONS_FILE = "decisions.jsonl";
const SETTINGS_FILE = "settings.json";

/**
 * The hook entry point, as an absolute path.
 *
 * Compiled beside this module in `dist`; running from `src` under the test
 * runner there is no `.js` beside it, and the built copy one directory over is
 * what a spawned `node` can actually load. Which is why `test` depends on this
 * package's own `build` in `turbo.json` and not only on its dependencies'.
 *
 * A missing entry is refused here rather than left to the hook: an unreadable
 * hook command fails every tool call with a loader stack trace, and the
 * sentence a person needs is that the package was not built.
 */
export function guardHookEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "guard-hook.js"), join(here, "..", "dist", "guard-hook.js")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "the runner's write-guard hook is not compiled: no guard-hook.js beside " +
      `${here} or under its dist. Run \`pnpm exec turbo run build\` before running an attempt.`,
  );
}

/** The settings block that installs the hook, as the binary reads it. */
export function preToolSettings(command: string): Record<string, unknown> {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: PRE_TOOL_MATCHER,
          hooks: [{ type: "command", command }],
        },
      ],
    },
  };
}

/**
 * Create the attempt's guard directory and write its state and settings.
 *
 * The hook command is the runner's own, built from `process.execPath` and a
 * path this package computed. Nothing a model returned reaches it.
 */
export function preparePreToolGuard(args: {
  worktree: string;
  tmpdir: string | null;
  profile: PermissionProfile;
  /** The contract's write globs. Omitted admits everything inside the worktree. */
  paths_allowed?: readonly string[];
  /**
   * The program the hook runs, as argv without the guard's directory, which is
   * always appended as its last argument. Overridden only by the test that
   * stands a different judgement in the hook's place to make the runner's two
   * readings disagree.
   */
  hookProgram?: readonly string[];
}): PreToolGuard {
  const host = HOST_TEMPORARY_DIRECTORY.TMPDIR ?? tmpdir();
  const directory = mkdtempSync(join(host, "focrux-guard-"));
  const guard: PreToolGuard = {
    directory,
    settingsPath: join(directory, SETTINGS_FILE),
    statePath: join(directory, STATE_FILE),
    decisionsPath: join(directory, DECISIONS_FILE),
  };
  const state: PreToolGuardState = {
    root: resolve(args.worktree),
    tmpdir: args.tmpdir === null ? null : resolve(args.tmpdir),
    cwd: resolve(args.worktree),
    paths_allowed: [...(args.paths_allowed ?? [])],
    allow_list: [...args.profile.command_allow_list],
    deny_list: [...args.profile.command_deny_list],
  };
  writeFileSync(guard.statePath, JSON.stringify(state), "utf8");
  writeFileSync(guard.decisionsPath, "", "utf8");
  const program = args.hookProgram ?? [process.execPath, guardHookEntry()];
  const command = [...program, directory].map(quote).join(" ");
  writeFileSync(guard.settingsPath, JSON.stringify(preToolSettings(command)), "utf8");
  return guard;
}

/** A shell word the hook command can carry, since the binary runs it in a shell. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Settings that install no hook at all (SCP-228).
 *
 * The direct-agent arm of the loop-versus-direct-agent registration runs under
 * the permissions a person gives Claude Code for ordinary work, not the
 * runner's — so nothing of the runner's decides its tool calls before they run.
 * The file is still written and still named on the invocation, because
 * `--settings` is the only settings source the invocation has and dropping it
 * would let a user-scoped hook back in.
 *
 * There is no state file: nothing reads one, and writing an allow-list no hook
 * consults would describe a judgement that does not happen.
 */
export function prepareUnguardedSettings(): AgentSettings {
  const host = HOST_TEMPORARY_DIRECTORY.TMPDIR ?? tmpdir();
  const directory = mkdtempSync(join(host, "focrux-unguarded-"));
  const settings: AgentSettings = {
    directory,
    settingsPath: join(directory, SETTINGS_FILE),
    decisionsPath: join(directory, DECISIONS_FILE),
  };
  writeFileSync(settings.settingsPath, JSON.stringify({ hooks: {} }), "utf8");
  writeFileSync(settings.decisionsPath, "", "utf8");
  return settings;
}

/** Remove the settings directory. A guard's decisions carry unredacted targets. */
export function discardPreToolGuard(guard: AgentSettings): void {
  rmSync(guard.directory, { recursive: true, force: true });
}

/** Every decision the hook has written so far, oldest first. */
export function readPreToolDecisions(path: string): PreToolDecision[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    // The hook never ran, or the directory is already gone.
    return [];
  }
  const decisions: PreToolDecision[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      decisions.push(JSON.parse(line) as PreToolDecision);
    } catch {
      // A torn append. The call it described falls back to the second reading.
    }
  }
  return decisions;
}

/**
 * What the hook prints, in the shape the binary parses.
 *
 * `null` is the third answer: printing nothing and exiting 0 is how a hook says
 * it has no opinion, and the agent's own permission layer then decides.
 */
export interface PreToolResponse {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "deny";
    permissionDecisionReason: string;
  };
}

/** The tool call as the hook receives it on stdin. */
export interface PreToolCall {
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: Record<string, unknown>;
}

/**
 * Verbs with no effect the guard has not already judged.
 *
 * `cd` and its family move the shell, which is SCP-170's tracking and decides
 * the *next* line's relative targets rather than this one. `echo` and `printf`
 * write only where a redirect points, and the redirect's target has already
 * been resolved by the time this is read. `true`, `false` and `:` do nothing at
 * all.
 *
 * They are not on the `--allowedTools` list and must not be: that list is
 * matched by prefix, so `Bash(cd:*)` on it would admit `cd x && rm -rf /`
 * whole. Here each segment is judged as itself.
 *
 * `echo` and `printf` earn their place because their only write is the
 * redirect. A program that acts on its own does not — `curl -o` writes without
 * one, and is on the deny-list.
 */
const EFFECT_FREE_VERBS = new Set(["cd", "pushd", "popd", "echo", "printf", "true", "false", ":"]);

/** Every command a line runs, the ones inside a nested shell included. */
function everySegment(segments: readonly CommandSegment[]): CommandSegment[] {
  return segments.flatMap((segment) => [segment, ...everySegment(segment.nested)]);
}

/**
 * Whether the runner has positive grounds to admit this line, or nothing to say.
 *
 * Grounds means at least one command on the line is one the guard judged — a
 * verb that writes to a path it names, or one whose effects are already
 * accounted for — and no command on it is one the guard has not judged and the
 * allow-list does not carry. `mkdir -p a && script -q /dev/null node x.js`
 * therefore has nothing to say: the `mkdir` is vouched for and the `script` is
 * not, and vouching for the line would admit both.
 */
function vouchesFor(
  segments: readonly CommandSegment[],
  allow_list: readonly string[],
): boolean {
  let grounds = false;
  for (const segment of everySegment(segments)) {
    if (segment.mutating) {
      grounds = true;
      continue;
    }
    // A segment that runs no program — `done`, `fi`, a bare assignment, a
    // redirect the resolver already placed — decides nothing on its own.
    if (segment.programs.length === 0) continue;
    if (segment.programs.every((program) => EFFECT_FREE_VERBS.has(program))) {
      grounds = true;
      continue;
    }
    if (allow_list.some((entry) => matchesListEntry(entry, "Bash", segment.text))) continue;
    return false;
  }
  return grounds;
}

/**
 * The judgement, and where it leaves the shell.
 *
 * `next_cwd` is only ever the answer for an **admitted** call: a refused call
 * does not run, so the `cd` on it never happened and the shell is where it was.
 * That is the one thing the pre-execution reading knows and the transcript
 * reading cannot, because before this hook existed a refused command had
 * already executed by the time the runner read it.
 */
export function judgePreToolCall(
  call: PreToolCall,
  state: PreToolGuardState,
  at: Date,
): { decision: PreToolDecision; next_cwd: string } {
  const tool = call.tool_name ?? "unknown";
  const input = call.tool_input ?? {};
  const scope = {
    root: state.root,
    ...(state.tmpdir === null ? {} : { tmpdir: state.tmpdir }),
    // The same globs the transcript reading is handed, from the one state the
    // adapter wrote: two readings of one contract cannot disagree about it.
    paths_allowed: state.paths_allowed ?? [],
  };

  /**
   * A tool this guard was not built for gets no answer at all.
   *
   * The matcher installs it for the five that write, so in an attempt nothing
   * else reaches here. But the function is called directly by tests and by
   * anything that later reuses it, and its file-tool branch reads `file_path` —
   * which `Read` also carries, so a `Read` outside the worktree came back
   * `write_outside_worktree`, refusing a read on a rule about writes. The
   * runner has no rule for a tool it does not judge, and `--disallowedTools`
   * still refuses the ones the profile names.
   */
  if (!(PRE_TOOL_JUDGED_TOOLS as readonly string[]).includes(tool)) {
    return {
      decision: {
        tool_use_id: call.tool_use_id ?? "",
        tool,
        answer: "defer",
        decision: "allowed",
        rule: null,
        target: null,
        reason: null,
        cwd: null,
        at: at.toISOString(),
      },
      next_cwd: state.cwd,
    };
  }

  if (tool === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    const { admission, inspection } = judgeCommand({
      tool,
      detail: command,
      allow_list: state.allow_list,
      deny_list: state.deny_list,
      scope: { ...scope, cwd: state.cwd },
    });
    const refused = admission.decision === "denied";
    const answer: PreToolAnswer = refused
      ? "deny"
      : vouchesFor(inspection.segments, state.allow_list)
        ? "allow"
        : "defer";
    return {
      decision: {
        tool_use_id: call.tool_use_id ?? "",
        tool,
        answer,
        decision: admission.decision,
        rule: admission.rule,
        target: admission.target,
        reason: admission.reason,
        cwd: inspection.cwd.relative,
        at: at.toISOString(),
      },
      // Only a call that runs moves the shell. A refused `cd` never happened,
      // and a deferred one may or may not have — the agent's layer decides
      // that, and the runner does not learn the answer until the result
      // envelope, so it follows the line rather than pretending to know.
      next_cwd: refused
        ? state.cwd
        : inspection.cwd.unknown
          ? UNKNOWN_CWD
          : (inspection.cwd.path ?? state.root),
    };
  }

  // A file tool is not a shell line: it names one absolute path and runs
  // wherever the agent process is. What SCP-161's third criterion asks for is
  // that path put through the same resolver a redirect target goes through,
  // before the write rather than at the seal.
  const path = filePath(input);
  const { admission } = judgeCommand({
    tool,
    detail: path === null ? tool : `${tool} ${path}`,
    allow_list: state.allow_list,
    deny_list: state.deny_list,
    scope,
    ...(path === null ? {} : { path }),
  });
  return {
    decision: {
      tool_use_id: call.tool_use_id ?? "",
      tool,
      // A path inside the worktree is not something to vouch for: the agent's
      // own layer carries `Write` and `Edit` and decides them as it always has.
      // The guard is here for the path that leaves the worktree.
      answer: admission.decision === "denied" ? "deny" : "defer",
      decision: admission.decision,
      rule: admission.rule,
      target: admission.target,
      reason: admission.reason,
      cwd: null,
      at: at.toISOString(),
    },
    next_cwd: state.cwd,
  };
}

/** The path a file tool writes to, under whichever name that tool uses. */
function filePath(input: Record<string, unknown>): string | null {
  for (const name of ["file_path", "notebook_path"]) {
    const value = input[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** The refusal the hook prints when it cannot judge at all. */
export function failClosed(reason: string): PreToolResponse {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * One hook invocation: read the state, judge, record, answer.
 *
 * Every failure answers `deny`. A hook that throws exits non-zero, and Claude
 * Code treats a non-zero exit other than 2 as a non-blocking error and runs the
 * tool anyway — so an exception here would be a guard that fails open.
 */
export function runPreToolHook(
  directory: string,
  stdin: string,
  at = new Date(),
): PreToolResponse | null {
  let state: PreToolGuardState;
  let call: PreToolCall;
  try {
    state = JSON.parse(readFileSync(join(directory, STATE_FILE), "utf8")) as PreToolGuardState;
    call = JSON.parse(stdin) as PreToolCall;
  } catch (error) {
    return failClosed(
      `the runner's write guard could not read its own state, so nothing is admitted: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let judged: ReturnType<typeof judgePreToolCall>;
  try {
    judged = judgePreToolCall(call, state, at);
  } catch (error) {
    return failClosed(
      `the runner's write guard could not judge this call: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    if (judged.next_cwd !== state.cwd) {
      // Replaced rather than rewritten in place, so a reader never sees half a
      // state file: the next call's judgement depends on all of it.
      const next: PreToolGuardState = { ...state, cwd: judged.next_cwd };
      const pending = join(directory, `${STATE_FILE}.pending`);
      writeFileSync(pending, JSON.stringify(next), "utf8");
      renameSync(pending, join(directory, STATE_FILE));
    }
    appendFileSync(join(directory, DECISIONS_FILE), `${JSON.stringify(judged.decision)}\n`, "utf8");
  } catch {
    // The decision stands whether or not the runner can read it back. Losing
    // the record must not turn a refusal into an admission.
  }

  if (judged.decision.answer === "defer") return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: judged.decision.answer === "allow" ? "allow" : "deny",
      permissionDecisionReason:
        judged.decision.reason ??
        "every target the runner's guard found is inside the attempt's worktree",
    },
  };
}

/** The rules a decision can name, re-exported so a reader of a record has one import. */
export { ADMISSION_RULES };
export { EFFECT_FREE_VERBS };
