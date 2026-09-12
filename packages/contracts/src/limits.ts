import { z } from "zod";

/**
 * Hard limits.
 *
 * One assertion over a limits table, plus per-attempt runner ceilings, is what
 * stops runaway work.
 *
 * The table is data, not code: it is read from a file on the machine running
 * the attempt.
 */

export const LIMITED_RESOURCES = [
  "concurrent_local_attempts",
  "local_workspace_bytes",
  "attempt_wall_clock_ms",
  "attempt_commands",
  "attempt_iterations",
  "round_iterations",
  "attempt_tokens",
  "attempt_cost_micros",
  "remediation_rounds",
  "ticket_cost_micros",
  "wait_for_provider_ms",
] as const;
export const LimitedResourceSchema = z.enum(LIMITED_RESOURCES);
export type LimitedResource = (typeof LIMITED_RESOURCES)[number];

/**
 * The three counters with no default (D-096).
 *
 * An iteration is one assistant event on the executor's stream — a message,
 * not a tool call — and a command is one tool call. Both were proxies for
 * spend, and cost, wall clock, fresh tokens and the ticket budget bound that
 * directly; every time an iteration ceiling fired it cut ordinary work. A
 * repository may set any of the three in its own configuration and then gets
 * exactly the ceiling it asked for.
 */
export const UNSET_UNLESS_CONFIGURED = [
  "attempt_commands",
  "attempt_iterations",
  "round_iterations",
] as const;
export type UnsetUnlessConfigured = (typeof UNSET_UNLESS_CONFIGURED)[number];

/** Every other resource: one number the table falls back to. */
export type DefaultedResource = Exclude<LimitedResource, UnsetUnlessConfigured>;

/**
 * Kill switches (SCP-087). Three, and no more: an organisation's automation, a
 * provider or model, and a global read-only mode. Each is a boolean a human
 * flips, not a policy engine.
 */
export const KillSwitchesSchema = z.strictObject({
  organisation_automation_disabled: z.boolean().default(false),
  disabled_providers: z.array(z.string().min(1)).default([]),
  disabled_models: z.array(z.string().min(1)).default([]),
  global_read_only: z.boolean().default(false),
});
export type KillSwitches = z.infer<typeof KillSwitchesSchema>;

/**
 * `concurrent_local_attempts` defaults to 1 and `local_workspace_bytes` to
 * 20 GiB because the execution substrate is a laptop (D-049). A ceiling that
 * assumes a cloud runner is not a ceiling.
 *
 * The last two bound a **ticket** rather than an attempt (SCP-193), and they
 * are here rather than in a table of their own because they are read from the
 * same file, overridden by the same `limits.limits.<name>` key in
 * `<repo>/.focrux/config.json`, and printed by the same `doctor` block.
 *
 * - `ticket_cost_micros` — $60. What one ticket may spend before the loop stops
 *   restarting itself. An attempt a ceiling cut is followed by another over the
 *   sealed branch until this is reached, so without it the per-attempt cost
 *   ceiling would bound a single attempt and nothing would bound the ticket.
 * - `wait_for_provider_ms` — 6 h. The longest the loop will sit out a provider
 *   session limit that named its own reset time. A reset further out than this
 *   is not waited for; the run stops and says so, because waking before the
 *   provider's own reset spends an attempt against a limit still in force.
 *
 * `remediation_rounds` is 6, raised from 2 (SCP-194). It is a hard cap above
 * the progress rule rather than the rule itself: a round that closed nothing
 * ends the ticket well before this, and a round that closed something earns the
 * next until either this or the ticket budget is reached. Two was a number, not
 * a measurement, and it stopped AYO-34 with one finding open that the round it
 * was refused would have closed.
 *
 * `attempt_commands`, `attempt_iterations` and `round_iterations` are absent,
 * which is the whole of D-096: they are the counters nothing defaults, so an
 * attempt and a remediation round are bounded by cost, wall clock, fresh
 * tokens, the round count and the ticket budget and by nothing counted in
 * messages or tool calls. A table that sets one gets that ceiling.
 */
export const DEFAULT_LIMITS: Readonly<Record<DefaultedResource, number>> &
  Readonly<Partial<Record<UnsetUnlessConfigured, number>>> = {
  concurrent_local_attempts: 1,
  local_workspace_bytes: 20 * 1024 * 1024 * 1024,
  attempt_wall_clock_ms: 30 * 60 * 1000,
  // Fresh tokens only — cache reads do not count, so this bounds work rather
  // than turns. See the adapter for why.
  attempt_tokens: 2_000_000,
  attempt_cost_micros: 5_000_000,
  remediation_rounds: 6,
  ticket_cost_micros: 60_000_000,
  wait_for_provider_ms: 6 * 60 * 60 * 1000,
};

/**
 * Overrides are partial and the key set is closed: an unknown resource name is
 * a typo that would otherwise silently raise no ceiling at all.
 */
const LimitOverridesSchema = z
  .record(z.string(), z.number().int().min(0))
  .superRefine((overrides, ctx) => {
    for (const key of Object.keys(overrides)) {
      if (!(LIMITED_RESOURCES as readonly string[]).includes(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message:
            `unknown limited resource '${key}' ` +
            `(known: ${LIMITED_RESOURCES.join(", ")})`,
        });
      }
    }
  });

export const LimitsTableSchema = z.strictObject({
  organisation: z.string().min(1),
  limits: LimitOverridesSchema.default({}),
  kill_switches: KillSwitchesSchema.prefault({}),
});
export type LimitsTable = z.infer<typeof LimitsTableSchema>;

export const DEFAULT_LIMITS_TABLE: LimitsTable = LimitsTableSchema.parse({
  organisation: "local",
});

export const LIMIT_EXCEEDED_REASONS = [
  "limit_exceeded",
  "automation_disabled",
  "read_only_mode",
  "provider_disabled",
] as const;
export type LimitExceededReason = (typeof LIMIT_EXCEEDED_REASONS)[number];

/**
 * The typed refusal. Every ceiling terminates an attempt with one of these and
 * an audit entry, rather than with a generic error a caller has to pattern-match
 * on a message string.
 */
export class LimitExceededError extends Error {
  readonly reason: LimitExceededReason;
  readonly resource: LimitedResource | null;
  readonly limit: number | null;
  readonly requested: number | null;

  constructor(
    reason: LimitExceededReason,
    resource: LimitedResource | null,
    limit: number | null,
    requested: number | null,
    message: string,
  ) {
    super(message);
    this.name = "LimitExceededError";
    this.reason = reason;
    this.resource = resource;
    this.limit = limit;
    this.requested = requested;
  }
}

/** The ceiling in force for a resource, or `null` where nothing sets one. */
export function limitFor(table: LimitsTable, resource: DefaultedResource): number;
export function limitFor(table: LimitsTable, resource: LimitedResource): number | null;
export function limitFor(table: LimitsTable, resource: LimitedResource): number | null {
  return table.limits[resource] ?? DEFAULT_LIMITS[resource] ?? null;
}

/**
 * SCP-087 acceptance criterion 1: one call gates every countable resource.
 *
 * `n` is the value **after** the increment the caller is about to make, so a
 * caller asking for the first of something passes 1. Equal to the limit is
 * allowed; above it is not, and a resource with no ceiling has nothing to be
 * above.
 */
export function assertWithinLimits(
  table: LimitsTable,
  resource: LimitedResource,
  n: number,
): void {
  if (table.kill_switches.global_read_only) {
    throw new LimitExceededError(
      "read_only_mode",
      resource,
      null,
      n,
      "global read-only mode is engaged: no attempt may start or continue",
    );
  }
  if (table.kill_switches.organisation_automation_disabled) {
    throw new LimitExceededError(
      "automation_disabled",
      resource,
      null,
      n,
      `automation is disabled for organisation ${table.organisation}`,
    );
  }
  const limit = limitFor(table, resource);
  // No ceiling is not a ceiling of infinity: nothing is tested, and the caller
  // keeps counting (D-096).
  if (limit !== null && n > limit) {
    throw new LimitExceededError(
      "limit_exceeded",
      resource,
      limit,
      n,
      `${resource} would reach ${n}, above the limit of ${limit}`,
    );
  }
}

/** Provider and model kill switches, checked before an attempt spends anything. */
export function assertProviderEnabled(
  table: LimitsTable,
  provider: string,
  model: string,
): void {
  if (table.kill_switches.disabled_providers.includes(provider)) {
    throw new LimitExceededError(
      "provider_disabled",
      null,
      null,
      null,
      `provider ${provider} is disabled by kill switch`,
    );
  }
  if (table.kill_switches.disabled_models.includes(model)) {
    throw new LimitExceededError(
      "provider_disabled",
      null,
      null,
      null,
      `model ${model} is disabled by kill switch`,
    );
  }
}
