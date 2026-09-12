import { execFileSync } from "node:child_process";
import { GH_NOT_LOGGED_IN } from "@focrux/contracts";
import {
  readGithubCredential,
  type GithubCredentialReading,
} from "./github-credential.js";

/**
 * What must be on this machine before `focrux run` can do anything, checked
 * before a worktree is provisioned rather than discovered as an ENOENT stack
 * trace with the ticket left in `provisioning`.
 *
 * Every check is a fixed argv against a fixed binary. Nothing here takes a
 * value from a model or from repository content.
 */

export interface PreflightFinding {
  severity: "blocking" | "warning";
  reason:
    | "node_too_old"
    | "git_missing"
    | "install_binary_missing"
    | "agent_binary_missing"
    | "gh_missing"
    | "gh_not_authenticated"
    | "reviewer_credential_missing"
    | "reviewer_binary_missing";
  detail: string;
  /** The one command or action that clears it. */
  fix: string;
}

export interface PreflightTool {
  present: boolean;
  version: string | null;
}

export interface PreflightResult {
  ok: boolean;
  findings: PreflightFinding[];
  tools: Record<string, PreflightTool>;
  /**
   * SCP-200: which credential path GitHub is read through here, and whether it
   * answers. Null where nothing asked — `gh` is not installed, or this run
   * neither publishes nor wanted the round trip.
   */
  github: GithubCredentialReading | null;
}

export interface PreflightRequest {
  /**
   * The coding agent binary the adapter will spawn, e.g. `claude`. `null`
   * when no agent runs — `focrux review` on its own — so only the reviewer's
   * transport is checked.
   */
  agentBinary: string | null;
  /** Which reviewer transport the run will use. */
  reviewerProvider: "anthropic" | "claude-cli" | "codex-cli";
  /** Whether the run will push and open a pull request through `gh`. */
  needsGh: boolean;
  /**
   * The binary the materialisation manifest installs a worktree with — `pnpm`
   * where a repository pins one. Null where the caller has none to name; a run
   * that provisions no worktree installs nothing.
   */
  installBinary?: string | null;
  /** Whether a worktree will be provisioned. Defaults to true; `review` alone needs no git. */
  needsGit?: boolean;
  /**
   * Ask `gh auth status` even where this run will not publish. `doctor` sets
   * it, because saying whether GitHub answers is what a diagnostic is for; a
   * run that only needs the binary present does not pay for the round trip.
   */
  probeGithub?: boolean;
  env?: NodeJS.ProcessEnv;
  minNodeMajor?: number;
}

function version(
  binary: string,
  env: NodeJS.ProcessEnv,
  args: readonly string[] = ["--version"],
): PreflightTool {
  try {
    const out = execFileSync(binary, [...args], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
      env,
    }).trim();
    return { present: true, version: out.split("\n")[0] ?? "" };
  } catch {
    return { present: false, version: null };
  }
}

export function preflight(request: PreflightRequest): PreflightResult {
  const env = request.env ?? process.env;
  const findings: PreflightFinding[] = [];
  const tools: Record<string, PreflightTool> = {};

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const minNode = request.minNodeMajor ?? 22;
  tools.node = { present: true, version: process.versions.node };
  if (nodeMajor < minNode) {
    findings.push({
      severity: "blocking",
      reason: "node_too_old",
      detail: `node ${process.versions.node} is below the ${minNode} this runner needs`,
      fix: `install Node ${minNode} or later and re-run`,
    });
  }

  if (request.needsGit ?? true) {
    tools.git = version("git", env);
    if (!tools.git.present) {
      findings.push({
        severity: "blocking",
        reason: "git_missing",
        detail: "`git` is not on PATH",
        fix: "install git (https://git-scm.com) and re-run",
      });
    }
  }

  // The install is the first command a run gives a worktree, and it is spawned
  // argv-only with no shell like every other command a run starts. Probing it
  // the same way is the whole point: on Windows a package manager installed as
  // a `.cmd` shim answers when a person types it and cannot be spawned without
  // a shell, so it is present to them and absent to the runner. Found here it
  // costs a sentence; found at materialisation it costs a provisioned worktree
  // and a ticket left in `provisioning`.
  const installBinary = request.installBinary ?? null;
  if (installBinary !== null && (request.needsGit ?? true)) {
    const tool = tools[installBinary] ?? version(installBinary, env);
    tools[installBinary] = tool;
    if (!tool.present) {
      findings.push({
        severity: "blocking",
        reason: "install_binary_missing",
        detail:
          `the materialisation manifest installs with \`${installBinary}\`, ` +
          "which cannot be run",
        fix:
          installBinary === "pnpm" && process.platform === "win32"
            ? "install pnpm as an executable (npm install -g @pnpm/exe); a `.cmd` shim answers in a shell but cannot be spawned without one"
            : `install \`${installBinary}\` and make sure it is on PATH`,
      });
    }
  }

  if (request.agentBinary !== null) {
    tools[request.agentBinary] = version(request.agentBinary, env);
    if (!tools[request.agentBinary]!.present) {
      findings.push({
        severity: "blocking",
        reason: "agent_binary_missing",
        detail: `the coding agent \`${request.agentBinary}\` is not on PATH`,
        fix:
          request.agentBinary === "claude"
            ? "install Claude Code (npm install -g @anthropic-ai/claude-code) and sign in with `claude`"
            : `install \`${request.agentBinary}\` and make sure it is on PATH`,
      });
    }
  }

  if (request.reviewerProvider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      findings.push({
        severity: "blocking",
        reason: "reviewer_credential_missing",
        detail: "the reviewer provider is `anthropic` and ANTHROPIC_API_KEY is not set",
        fix: "export ANTHROPIC_API_KEY=… or use --provider claude-cli to review on your Claude Code login",
      });
    }
  } else if (request.reviewerProvider === "claude-cli") {
    if (request.agentBinary !== "claude") {
      tools.claude = version("claude", env);
      if (!tools.claude.present) {
        findings.push({
          severity: "blocking",
          reason: "reviewer_binary_missing",
          detail: "the reviewer provider is `claude-cli` and `claude` is not on PATH",
          fix: "install Claude Code (npm install -g @anthropic-ai/claude-code) and sign in with `claude`",
        });
      }
    }
  } else if (request.reviewerProvider === "codex-cli") {
    const codex = env.FOCRUX_CODEX_BINARY ?? "codex";
    tools.codex = version(codex, env);
    if (!tools.codex.present) {
      findings.push({
        severity: "blocking",
        reason: "reviewer_binary_missing",
        detail: `the reviewer provider is \`codex-cli\` and \`${codex}\` cannot be run`,
        fix: "set FOCRUX_CODEX_BINARY to the Codex executable, or use --provider claude-cli",
      });
    }
  }

  // `gh` is checked whether or not this run publishes: `sync`, `stops` and
  // the next `--publish` all need it, and a partner's first hour should hear
  // about it once, as a warning, rather than at the first pull request.
  tools.gh = version("gh", env);
  const ghSeverity = request.needsGh ? "blocking" : "warning";
  let github: GithubCredentialReading | null = null;
  if (!tools.gh.present) {
    findings.push({
      severity: ghSeverity,
      reason: "gh_missing",
      detail: request.needsGh
        ? "`gh` is not on PATH and --publish opens the pull request through it"
        : "`gh` is not on PATH; publishing, `sync` and `stops` need it",
      fix: "install the GitHub CLI (https://cli.github.com) and run `gh auth login`",
    });
  } else if (request.needsGh || request.probeGithub) {
    // SCP-200: which credential path GitHub is read through, decided here and
    // once. `gh auth status` is a network round-trip, so only a run that will
    // publish — or a caller that asked, which is `doctor` — pays for it; a run
    // that does neither is told about a missing binary only.
    //
    // A `GH_TOKEN` in the environment is the path whether or not GitHub
    // accepts it: this is where a missing credential is refused, not where a
    // rejected one is. Only the machine's shared `gh` login can be missing in
    // the sense that stops a run before it starts.
    github = readGithubCredential({ env });
    if (github.credential === "gh_login" && !github.answers) {
      findings.push({
        severity: ghSeverity,
        reason: "gh_not_authenticated",
        detail:
          `${GH_NOT_LOGGED_IN} and no GH_TOKEN is set` +
          (request.needsGh
            ? ", and --publish opens the pull request through one of them"
            : "; publishing, `sync` and `stops` need one of them"),
        fix: "run `gh auth login`, or export GH_TOKEN with a token scoped to this repository",
      });
    }
  }

  return {
    ok: findings.every((finding) => finding.severity !== "blocking"),
    findings,
    tools,
    github,
  };
}

export function renderPreflight(result: PreflightResult): string {
  const lines: string[] = [];
  for (const [name, tool] of Object.entries(result.tools)) {
    lines.push(`  ${tool.present ? "✓" : "✗"} ${name.padEnd(8)} ${tool.version ?? "not found"}`);
  }
  if (result.github) {
    // SCP-200: the path, and whether it answered. Never the token, not even a
    // prefix — this block is what a person pastes into an issue.
    const path = result.github.credential === "GH_TOKEN" ? "GH_TOKEN" : "gh login";
    const answer = result.github.answers
      ? "`gh auth status` answers"
      : result.github.credential === "GH_TOKEN"
        ? "`gh auth status` does not answer: GitHub refused the token"
        : GH_NOT_LOGGED_IN;
    lines.push(`  ${result.github.answers ? "✓" : "✗"} ${"github".padEnd(8)} ${path}, and ${answer}`);
  }
  for (const finding of result.findings) {
    lines.push("", `  ${finding.severity}  ${finding.reason}: ${finding.detail}`, `           fix: ${finding.fix}`);
  }
  return lines.join("\n");
}
