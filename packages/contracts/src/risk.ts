import type { ChangeSet } from "./changeset.js";
import {
  isAgentConfigPath,
  isConfigPath,
  isDependencyPath,
  isMigrationPath,
  isSecurityPath,
  matchesAny,
  packageOf,
} from "./paths.js";
import { PLAN_LEVELS, type PlanLevel, type Scope } from "./plan.js";

/**
 * Risk is computed twice (docs/04, D-010).
 *
 * `planned_risk` — declared scope, repository sensitivity and requested action
 * class — selects the plan level and the approvals needed to start.
 * `actual_risk` — the final diff plus dependency, configuration, schema and
 * security changes — is computed at change-set seal. If actual exceeds planned
 * the attempt is escalated, not discarded.
 */

const ORDER: Record<PlanLevel, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function compareLevels(a: PlanLevel, b: PlanLevel): number {
  return ORDER[a] - ORDER[b];
}

export function maxLevel(a: PlanLevel, b: PlanLevel): PlanLevel {
  return compareLevels(a, b) >= 0 ? a : b;
}

/** A human may raise either level; a human may not lower either. */
export function raisePlanLevel(current: PlanLevel, proposed: PlanLevel): PlanLevel {
  if (compareLevels(proposed, current) < 0) {
    throw new Error(
      `plan level may be raised but not lowered: ${current} -> ${proposed} ` +
        `(order: ${PLAN_LEVELS.join(" < ")})`,
    );
  }
  return proposed;
}

export type RepositorySensitivity = "standard" | "sensitive";
export type ActionClass = "read_only" | "reversible_change" | "irreversible_change";

export interface PlannedRiskInputs {
  scope: Scope;
  repository_sensitivity: RepositorySensitivity;
  action_class: ActionClass;
}

export interface RiskDerivation {
  level: PlanLevel;
  reasons: string[];
}

/**
 * A declared scope over these derives to P3 at admission. CI, infrastructure
 * and policy take effect outside the pull request that carries them, which is
 * docs/04's P3 trigger — irreversible or material — applied to a scope rather
 * than to a diff.
 */
export const PLANNED_P3_PATTERNS = [
  ".github/**",
  "infra/**",
  "**/policy/**",
  "**/policies/**",
] as const;

export const isPlannedP3Path = (path: string) => matchesAny(path, PLANNED_P3_PATTERNS);

/**
 * The level a declared scope derives to. Level is derived, not chosen
 * (docs/04): a person may raise the result with `raisePlanLevel` and may not
 * lower it.
 *
 * Applied to globs, not files: a declared `packages/auth/**` matches the
 * security pattern for an `auth` directory the same way a file under it would,
 * so a scope that names a sensitive directory derives as if every file in it
 * were touched.
 */
export function derivePlannedRisk(inputs: PlannedRiskInputs): RiskDerivation {
  const reasons: string[] = [];
  if (inputs.action_class === "read_only") {
    return { level: "P0", reasons: ["action class is read-only"] };
  }
  if (inputs.action_class === "irreversible_change") {
    return { level: "P3", reasons: ["action class is irreversible"] };
  }

  let level: PlanLevel = "P1";
  const declared = [...inputs.scope.paths_allowed];
  const packages = new Set(declared.map((pattern) => packageOf(pattern)));
  if (packages.size > 1) {
    level = maxLevel(level, "P2");
    reasons.push(`declared scope spans ${packages.size} packages`);
  }
  if (inputs.repository_sensitivity === "sensitive") {
    level = maxLevel(level, "P2");
    reasons.push("repository is marked sensitive");
  }
  for (const pattern of declared) {
    if (isMigrationPath(pattern)) {
      level = maxLevel(level, "P2");
      reasons.push(`declared scope includes a migration path (${pattern})`);
    }
    if (isSecurityPath(pattern)) {
      level = maxLevel(level, "P2");
      reasons.push(`declared scope includes a security-sensitive path (${pattern})`);
    }
    if (isDependencyPath(pattern)) {
      level = maxLevel(level, "P2");
      reasons.push(`declared scope includes a dependency manifest (${pattern})`);
    }
    if (isConfigPath(pattern)) {
      level = maxLevel(level, "P2");
      reasons.push(`declared scope includes configuration (${pattern})`);
    }
    if (isAgentConfigPath(pattern)) {
      level = maxLevel(level, "P2");
      reasons.push(
        `declared scope includes repository-supplied agent configuration (${pattern}) (ADR-0030)`,
      );
    }
    if (isPlannedP3Path(pattern)) {
      level = maxLevel(level, "P3");
      reasons.push(`declared scope includes CI, infrastructure or policy (${pattern})`);
    }
  }
  if (reasons.length === 0) reasons.push("reversible change inside one package");
  return { level, reasons };
}

/**
 * Derived from what the change actually did.
 *
 * "Externally visible behaviour" is in the specification's P2 trigger list and
 * is deliberately not derived here: nothing in a diff establishes it, and a
 * guess would be a confident wrong answer in a gate. It is reachable only by a
 * human raising the level.
 *
 * `scope` is optional but should be supplied: without it a lockfile update
 * reads as a dependency change and carries a schema migration's blocking policy
 * into an ordinary change. `generated_paths` exempts a file here exactly as it
 * does in scope accounting, and — exactly as there — a prohibited path is never
 * exempted, so the exemption cannot launder one.
 */
export function deriveActualRisk(changeset: ChangeSet, scope?: Scope): RiskDerivation {
  const exempt = (path: string) =>
    scope !== undefined &&
    !matchesAny(path, scope.paths_prohibited) &&
    matchesAny(path, scope.generated_paths);

  const generated: string[] = [];
  const touched: string[] = [];
  for (const file of changeset.files) {
    (exempt(file.path) ? generated : touched).push(file.path);
  }

  const reasons: string[] = [];
  let level: PlanLevel = "P1";
  const packages = new Set(touched.map((path) => packageOf(path)));

  if (packages.size > 1) {
    level = maxLevel(level, "P2");
    reasons.push(`diff touches ${packages.size} packages: ${[...packages].sort().join(", ")}`);
  }
  for (const path of touched) {
    if (isMigrationPath(path)) {
      level = maxLevel(level, "P2");
      reasons.push(`schema or data migration changed: ${path}`);
    }
    if (isDependencyPath(path)) {
      level = maxLevel(level, "P2");
      reasons.push(`dependency manifest changed: ${path}`);
    }
    if (isConfigPath(path)) {
      level = maxLevel(level, "P2");
      reasons.push(`configuration changed: ${path}`);
    }
    if (isSecurityPath(path)) {
      level = maxLevel(level, "P2");
      reasons.push(`security-sensitive path changed: ${path}`);
    }
    if (isAgentConfigPath(path)) {
      level = maxLevel(level, "P2");
      reasons.push(`repository-supplied agent configuration changed: ${path} (ADR-0030)`);
    }
  }

  // Only after the risk reasons, so an all-generated change still reads as P1
  // with a reason rather than as reasoned by the exemption note.
  if (reasons.length === 0) reasons.push("reversible change inside one package");
  if (generated.length > 0) {
    reasons.push(`exempt as generated: ${[...generated].sort().join(", ")}`);
  }
  return { level, reasons };
}
