import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

/**
 * Where a `git push` goes.
 *
 * The runner performs the push to GitHub and the agent never publishes; that
 * is what the bare `git push` rule refuses. A push whose remote is a
 * filesystem path inside the attempt's worktree or its temporary directory
 * publishes nothing — it is an executor building a test against a bare
 * fixture — and is the agent's ordinary work. Everything else stays the
 * runner's: a URL of any scheme but `file`, a path outside both directories,
 * a remote that cannot be resolved, and a push that names no remote at all.
 *
 * Resolution follows git's own precedence and asks git itself: the target is
 * first read as a configured remote through `git remote get-url --push`, run
 * with the command's own global flags (`-C`, `--git-dir`, `--work-tree`, `-c`)
 * from the shell's directory, so the repository git would address and the
 * URL it would push to — `pushurl`, `insteadOf` rewrites — are the ones read.
 * Only a target that is no remote is read as a URL or a path, and a path
 * counts only where it exists. Anything the resolution cannot reproduce — a
 * `GIT_DIR` set in the environment, a `--config-env` — is refused.
 */

export interface PushReading {
  /** The remote as written after the flags, or null where none is named. */
  remote: string | null;
  /** git's global flags as written, in order, each with its value beside it. */
  globals: string[];
  /** Whether the push recurses into submodules by its own flag: `on-demand` or `only` push them, `no` and `check` do not. */
  recursesSubmodules: boolean | null;
  /** What made the command unreproducible here: an environment assignment, a flag git reads the environment for, a subshell. */
  unreproducible: string | null;
}

export type PushDestination =
  | { kind: "local"; path: string }
  | { kind: "url"; url: string }
  | { kind: "outside"; path: string }
  | { kind: "unresolved"; reason: string };

export interface PushScope {
  /** The attempt's worktree, absolute; null where the caller named none. */
  root: string | null;
  /** The attempt's temporary directory, absolute; null where there is none. */
  tmpdir: string | null;
  /** Where the shell stands when the push runs; null where unknown. */
  cwd: string | null;
}

/** Global git flags whose value is the next word. */
const GLOBAL_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--super-prefix",
]);
/** Global flags whose meaning depends on the environment git would read, which is not this one. */
const GLOBAL_FROM_ENVIRONMENT = new Set(["--config-env"]);
/**
 * An assignment before `git`. Any of them can change what git reads — `GIT_DIR`
 * where it looks, `HOME` or `XDG_CONFIG_HOME` which configuration rewrites
 * its URLs, `PATH` which git runs — and the resolution below runs git in the
 * runner's environment, not the segment's, so none of them is reproduced.
 */
const ENVIRONMENT_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;
/** Words that may stand before `git` without changing what it does. */
const PLAIN_WRAPPERS = new Set(["env", "command", "exec", "nice", "nohup", "time", "stdbuf"]);

/** Push options whose value is the next word. */
const PUSH_WITH_VALUE = new Set(["-o", "--push-option", "--receive-pack", "--exec", "--repo"]);

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `ext::<command>`, `fd::<n>`: a transport git runs rather than a place, and never a path. */
const TRANSPORT_URL = /^[a-z][a-z0-9+.-]*::/i;
/** `user@host:path`, the scp-like spelling git accepts without a scheme. */
const SCP_LIKE = /^[^\s/@]+@[^\s/:]+:/;
const GIT_TIMEOUT_MS = 3_000;

/** A segment's words, with quotes and backslash escapes read the way a shell reads them. */
function words(segment: string): string[] {
  const out: string[] = [];
  let current = "";
  let started = false;
  let quote: string | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i]!;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < segment.length) {
        i += 1;
        current += segment[i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === "\\" && i + 1 < segment.length) {
      i += 1;
      current += segment[i];
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

/** What a `git push` segment names; null where the segment is not a push. */
export function readPush(segment: string): PushReading | null {
  const ws = words(segment);
  const at = ws.findIndex((word) => word === "git" || word.endsWith("/git"));
  if (at < 0) return null;
  let unreproducible: string | null = null;
  for (const word of ws.slice(0, at)) {
    const assignment = ENVIRONMENT_ASSIGNMENT.exec(word);
    if (assignment !== null) {
      unreproducible = unreproducible ?? `${assignment[1]} is set for git in the environment`;
    } else if (!PLAIN_WRAPPERS.has(word)) {
      // A subshell, a `cd`, a wrapper's option (`env -i` empties the
      // environment), or anything else the segment runs before git: what git
      // gets is not what the resolution below reproduces.
      unreproducible = unreproducible ?? "the push is not the first command its segment runs";
    }
  }
  const globals: string[] = [];
  let i = at + 1;
  for (; i < ws.length; i += 1) {
    const word = ws[i]!;
    if (!word.startsWith("-")) break;
    const [flag] = word.split("=", 1);
    if (GLOBAL_FROM_ENVIRONMENT.has(flag!)) {
      unreproducible = unreproducible ?? `${flag} reads git's configuration from the environment`;
      if (!word.includes("=")) i += 1;
      continue;
    }
    if (word.includes("=") || !GLOBAL_WITH_VALUE.has(word)) {
      globals.push(word);
      continue;
    }
    const value = ws[i + 1];
    i += 1;
    if (value === undefined) continue;
    globals.push(word, value);
  }
  if (ws[i] !== "push") return null;
  // git reads its options wherever they stand, before or after the remote and
  // the refspecs, up to a bare `--`; so does this.
  let remote: string | null = null;
  let repo: string | null = null;
  let recursesSubmodules: boolean | null = null;
  for (i += 1; i < ws.length; i += 1) {
    const word = ws[i]!;
    if (word === "--") {
      remote = remote ?? ws[i + 1] ?? null;
      break;
    }
    if (word.startsWith("--repo=")) {
      repo = word.slice("--repo=".length);
      continue;
    }
    if (word.startsWith("--recurse-submodules")) {
      const mode = word.includes("=") ? word.split("=")[1] : "on-demand";
      recursesSubmodules = mode !== "no" && mode !== "check";
      continue;
    }
    if (word === "--no-recurse-submodules") {
      recursesSubmodules = false;
      continue;
    }
    if (word.startsWith("-")) {
      if (!word.includes("=") && PUSH_WITH_VALUE.has(word)) {
        if (word === "--repo") repo = ws[i + 1] ?? null;
        i += 1;
      }
      continue;
    }
    // The first word that is not an option is the remote; the rest are refspecs.
    if (remote === null) remote = word;
  }
  return { remote: remote ?? repo, globals, recursesSubmodules, unreproducible };
}

/** The path in the same spelling the scope's directories carry, or the path as given where it does not exist. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function inside(path: string, directory: string | null): boolean {
  if (directory === null) return false;
  return path === directory || path.startsWith(directory + sep);
}

function fromFileUrl(url: string): string | null {
  const rest = url.slice("file://".length);
  const withoutHost = rest.startsWith("localhost/") ? rest.slice("localhost".length) : rest;
  if (!withoutHost.startsWith("/")) return null;
  try {
    return decodeURIComponent(withoutHost);
  } catch {
    return withoutHost;
  }
}

/**
 * The URL git would push to for a configured remote, with the command's own
 * global flags applied from the shell's directory, so `-C`, `--git-dir`,
 * `--work-tree` and `-c` address what they would address for the push. Null
 * where the name is no remote there, or git could not answer in time.
 */
/**
 * The repository's top-level directory as git sees it for this command, which
 * is what git resolves a relative remote path against — from a subdirectory
 * too, where the shell's directory would be one level too deep.
 */
type GitAnswer =
  | { kind: "answer"; out: string }
  /** git ran and said no: its exit status and what it said. */
  | { kind: "refused"; status: number; stderr: string }
  /** git did not answer: absent, slower than the ceiling, killed. */
  | { kind: "unavailable"; reason: string };

/** One git question, from the shell's directory with the command's own global flags. */
function askGit(args: readonly string[], globals: readonly string[], cwd: string): GitAnswer {
  try {
    const out = execFileSync("git", [...globals, ...args], {
      cwd,
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return { kind: "answer", out };
  } catch (error) {
    const failure = error as { status?: number | null; stderr?: string | Buffer; code?: string };
    if (typeof failure.status === "number") {
      return { kind: "refused", status: failure.status, stderr: String(failure.stderr ?? "") };
    }
    return { kind: "unavailable", reason: `git could not be asked (${failure.code ?? "no exit status"})` };
  }
}

const NOT_A_REPOSITORY = /not a git repository/i;

/** The repository's top level as git sees it for this command — what a relative remote path is read against, from a subdirectory too. */
function topLevel(globals: readonly string[], cwd: string): { path: string } | { reason: string } {
  const answer = askGit(["rev-parse", "--show-toplevel"], globals, cwd);
  if (answer.kind === "unavailable") return { reason: answer.reason };
  if (answer.kind === "refused") {
    return {
      reason: NOT_A_REPOSITORY.test(answer.stderr)
        ? `git finds no repository for the push from ${cwd}`
        : `git could not place the push (exit ${answer.status})`,
    };
  }
  return answer.out.length > 0 ? { path: answer.out } : { reason: "git named no top level for the push" };
}

/**
 * Whether git would push submodules along: the push's own flag where it has
 * one, else `push.recurseSubmodules` or `submodule.recurse` in the
 * configuration git reads for this command. A recursed push goes to the
 * submodules' remotes, which this resolution never reads, so it is refused.
 */
function recursesIntoSubmodules(reading: PushReading, cwd: string): boolean | { reason: string } {
  if (reading.recursesSubmodules !== null) return reading.recursesSubmodules;
  for (const key of ["push.recurseSubmodules", "submodule.recurse"]) {
    const answer = askGit(["config", "--get", key], reading.globals, cwd);
    if (answer.kind === "unavailable") return { reason: answer.reason };
    // Status 1 is git's "not set"; any other refusal is git not answering.
    if (answer.kind === "refused") {
      if (answer.status === 1) continue;
      return { reason: `git could not say whether the push recurses (exit ${answer.status})` };
    }
    const value = answer.out.trim().toLowerCase();
    if (value === "on-demand" || value === "only" || value === "true" || value === "yes" || value === "1") {
      return true;
    }
  }
  return false;
}

type PushUrl =
  | { kind: "url"; url: string }
  | { kind: "no_such_remote" }
  | { kind: "unavailable"; reason: string };

/** The URL git would push to for a configured remote; "no such remote" is git's own answer, status 2. */
function pushUrl(name: string, globals: readonly string[], cwd: string): PushUrl {
  const answer = askGit(["remote", "get-url", "--push", name], globals, cwd);
  if (answer.kind === "answer") {
    return answer.out.length === 0 ? { kind: "no_such_remote" } : { kind: "url", url: answer.out };
  }
  if (answer.kind === "refused") {
    if (answer.status === 2 && /No such remote/i.test(answer.stderr)) return { kind: "no_such_remote" };
    if (NOT_A_REPOSITORY.test(answer.stderr)) {
      return { kind: "unavailable", reason: `${cwd} is not inside a git repository` };
    }
    return { kind: "unavailable", reason: `git could not say where ${name} goes (exit ${answer.status})` };
  }
  return { kind: "unavailable", reason: `${answer.reason} where ${name} goes` };
}

function placePath(path: string, base: string, scope: PushScope): PushDestination {
  const absolute = real(isAbsolute(path) ? path : resolve(base, path));
  if (inside(absolute, scope.root === null ? null : real(scope.root))) {
    return { kind: "local", path: absolute };
  }
  if (inside(absolute, scope.tmpdir === null ? null : real(scope.tmpdir))) {
    return { kind: "local", path: absolute };
  }
  return { kind: "outside", path: absolute };
}

/** A URL is a URL; a `file://` URL and a path are placed against the attempt's directories. */
function placeTarget(target: string, base: string, scope: PushScope, viaRemote: boolean): PushDestination {
  if (target.toLowerCase().startsWith("file://")) {
    const path = fromFileUrl(target);
    return path === null
      ? { kind: "unresolved", reason: `${target} is a file URL without a path` }
      : placePath(path, base, scope);
  }
  if (URL_SCHEME.test(target) || SCP_LIKE.test(target) || TRANSPORT_URL.test(target)) {
    return { kind: "url", url: target };
  }
  const candidate = isAbsolute(target) ? target : resolve(base, target);
  if (existsSync(candidate)) return placePath(candidate, base, scope);
  return {
    kind: "unresolved",
    reason: viaRemote
      ? `the remote's path ${target} does not exist`
      : `${target} is neither a remote nor a path that exists`,
  };
}

export function resolvePushDestination(reading: PushReading, scope: PushScope): PushDestination {
  if (scope.root === null) return { kind: "unresolved", reason: "no worktree was named" };
  if (scope.cwd === null) {
    return { kind: "unresolved", reason: "the shell's directory is unknown" };
  }
  if (reading.unreproducible !== null) {
    return { kind: "unresolved", reason: reading.unreproducible };
  }
  if (reading.remote === null) {
    return { kind: "unresolved", reason: "no remote is named, so the push goes to the branch's upstream" };
  }
  // A relative remote path is read against the repository's top level, as git
  // reads it; a command git cannot place in a repository is refused.
  const top = topLevel(reading.globals, scope.cwd);
  if ("reason" in top) return { kind: "unresolved", reason: top.reason };
  const base = top.path;
  const recurses = recursesIntoSubmodules(reading, scope.cwd);
  if (recurses === true) {
    return { kind: "unresolved", reason: "the push recurses into submodules, whose remotes are not read" };
  }
  if (recurses !== false) return { kind: "unresolved", reason: recurses.reason };
  const configured = pushUrl(reading.remote, reading.globals, scope.cwd);
  if (configured.kind === "unavailable") return { kind: "unresolved", reason: configured.reason };
  if (configured.kind === "url") return placeTarget(configured.url, base, scope, true);
  return placeTarget(reading.remote, base, scope, false);
}

/**
 * A URL with its userinfo removed, in both spellings git accepts: a remote can
 * carry a token, and a refusal must not. A transport (`ext::<command>`) is
 * named by its scheme alone, because the command after it is the executor's
 * text and can carry anything.
 */
function withoutCredential(url: string): string {
  const transport = TRANSPORT_URL.exec(url);
  if (transport !== null) return `${transport[0]}…`;
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, "$1")
    // The scp-like spelling carries a secret only as `user:secret@host:`; a
    // bare `git@host:` is the remote's name and stays.
    .replace(/^[^\s/@:]+:[^\s/@]*@(?=[^\s/:]+:)/, "");
}

/** Why a push counted as the runner's, for the refusal's detail. */
export function describePushDestination(destination: PushDestination): string {
  switch (destination.kind) {
    case "local":
      return `its remote resolves to ${destination.path}, inside the attempt's directories`;
    case "url":
      return `its remote resolves to ${withoutCredential(destination.url)}, a URL`;
    case "outside":
      return `its remote resolves to ${destination.path}, outside the worktree and the attempt's temporary directory`;
    case "unresolved":
      return destination.reason;
  }
}
