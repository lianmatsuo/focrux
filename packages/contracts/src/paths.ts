/**
 * Path classification, in one place because two things depend on it: scope
 * enforcement (deterministic, and required to be perfect) and risk derivation.
 * Two copies of "what counts as a migration" would drift.
 */

/** Minimal glob: `*` within a segment, `**` across segments, `?` one character. */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? "";
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more leading segments; a bare `**` matches the rest.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

/**
 * Whether a repository-relative path is inside a set of globs. An empty set
 * admits everything, which is what the runner's guard is handed when no
 * contract named any (SCP-195).
 */
export function insideAllowedPaths(path: string, globs: readonly string[]): boolean {
  return globs.length === 0 || matchesAny(path, globs);
}

/**
 * The package a path belongs to. `packages/x/**` and `apps/x/**` are two
 * segments deep; anything else is its top-level directory.
 */
export function packageOf(path: string): string {
  const segments = path.split("/");
  const first = segments[0] ?? "";
  if ((first === "packages" || first === "apps" || first === "tooling") && segments.length > 1) {
    return `${first}/${segments[1]}`;
  }
  return first;
}

/** A schema or data migration. Non-expand/contract changes are the hazard class. */
export const MIGRATION_PATTERNS = [
  "**/migrations/**",
  "**/migration/**",
  "infra/migrations/**",
  "**/*.sql",
  "**/schema.prisma",
  "**/schema.rb",
] as const;

/** Dependency manifests and lockfiles. */
export const DEPENDENCY_PATTERNS = [
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pyproject.toml",
  "**/requirements*.txt",
  "**/uv.lock",
  "**/Cargo.toml",
  "**/Cargo.lock",
  "**/go.mod",
  "**/go.sum",
  "**/Gemfile",
  "**/Gemfile.lock",
] as const;

/** Configuration that changes how the system runs rather than what it computes. */
export const CONFIG_PATTERNS = [
  ".github/**",
  "infra/**",
  "**/Dockerfile",
  "**/docker-compose*.yml",
  "**/*.tf",
  "**/tsconfig*.json",
  "**/*.config.js",
  "**/*.config.mjs",
  "**/*.config.ts",
] as const;

/** Paths where a mistake is a security incident rather than a bug. */
export const SECURITY_PATTERNS = [
  "**/auth/**",
  "**/authn/**",
  "**/authz/**",
  "**/billing/**",
  "**/payment*/**",
  "**/session*/**",
  "**/crypto/**",
  "**/security/**",
  "**/*.pem",
  "**/*.key",
  "**/.env*",
  "**/secrets/**",
] as const;

/**
 * Repository-supplied agent configuration (ADR-0030). It is not a scope
 * question — it is an execution and egress channel that runs before any of the
 * product's controls apply, so a change to it is always at least P2 and is
 * called out by name rather than folded into "config".
 */
export const AGENT_CONFIG_PATTERNS = [
  "**/.claude/**",
  "**/.mcp.json",
  "**/.cursor/**",
  "**/.aider*",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/.agent/**",
  "**/.codex/**",
] as const;

export const isMigrationPath = (path: string) => matchesAny(path, MIGRATION_PATTERNS);
export const isDependencyPath = (path: string) => matchesAny(path, DEPENDENCY_PATTERNS);
export const isConfigPath = (path: string) => matchesAny(path, CONFIG_PATTERNS);
export const isSecurityPath = (path: string) => matchesAny(path, SECURITY_PATTERNS);
export const isAgentConfigPath = (path: string) => matchesAny(path, AGENT_CONFIG_PATTERNS);

/**
 * The globs a contract admits a **write** under, which is what the runner's
 * write guard enforces before a tool runs (SCP-195).
 *
 * Wider than `paths_allowed`, because `paths_allowed` is not the whole of what
 * the contract permits and a guard narrower than the contract would refuse work
 * the contract asked for:
 *
 * - **the declared packages, while the expansion budget is positive.** A diff
 *   touching a path outside `paths_allowed` but inside the same package, within
 *   `expansion_budget_files`, is an advisory finding rather than a gate
 *   (docs/04, "In-flight scope expansion") and the executor's brief invites it
 *   by name. Refusing those writes would make the budget unreachable. Beyond the
 *   budget it is the review that blocks, on a count only the change set has.
 * - **the generated paths**, which are exempt from scope accounting entirely.
 *
 * `**` anywhere admits everything, so a ticketless run — whose scope is exactly
 * `**` — is judged by the worktree root alone, as it was before this existed.
 *
 * `paths_prohibited` is deliberately not subtracted: a prohibited path inside
 * the allowed ones is a blocking review finding, and the guard is not the place
 * to author a second rule about it.
 */
export function admittedWriteGlobs(scope: {
  paths_allowed: readonly string[];
  generated_paths?: readonly string[];
  expansion_budget_files?: number;
}): string[] {
  const globs: string[] = [...scope.paths_allowed];
  if ((scope.expansion_budget_files ?? 0) > 0) {
    for (const pattern of scope.paths_allowed) globs.push(`${packageOf(pattern)}/**`);
  }
  globs.push(...(scope.generated_paths ?? []));
  return [...new Set(globs)];
}
