import {
  LimitExceededError,
  assertWithinLimits,
  limitFor,
  type LimitedResource,
  type LimitsTable,
  type TerminationReason,
} from "@focrux/contracts";

/**
 * Per-attempt ceilings, enforced in the runner rather than by the model
 * (SCP-087, docs/08, threat 11).
 *
 * "By the runner" is the whole content of the requirement. A prompt that asks
 * an agent to stop after forty commands is a request; a counter that kills the
 * process is a ceiling. Every one of these terminates the attempt with a typed
 * reason and an audit entry, so a run that stopped is distinguishable from a
 * run that finished.
 *
 * Iterations and commands are counted here and bound nothing unless the
 * repository set a ceiling for them (D-096): the record says what a run did
 * either way, and what stops an attempt is cost, wall clock or fresh tokens.
 */

const REASON_FOR: Record<LimitedResource, TerminationReason> = {
  attempt_wall_clock_ms: "wall_clock_exceeded",
  attempt_commands: "command_ceiling_exceeded",
  attempt_iterations: "iteration_ceiling_exceeded",
  round_iterations: "round_iteration_ceiling_exceeded",
  attempt_tokens: "token_ceiling_exceeded",
  attempt_cost_micros: "cost_ceiling_exceeded",
  concurrent_local_attempts: "workspace_error",
  local_workspace_bytes: "workspace_error",
  remediation_rounds: "workspace_error",
  // Neither of these is a per-attempt counter and `AttemptCeilings` never
  // tests either: `ticket_cost_micros` bounds how many attempts a ticket gets
  // and `wait_for_provider_ms` bounds a wait between them, both decided in the
  // loop where the run rather than the attempt is in view (SCP-193). The rows
  // exist because the map is total over the resource set, and the reason they
  // carry is the one an unreachable breach would deserve.
  ticket_cost_micros: "workspace_error",
  wait_for_provider_ms: "workspace_error",
};

export interface CeilingBreach {
  reason: TerminationReason;
  resource: LimitedResource;
  /** Null where a kill switch stopped an attempt on a resource nothing bounds. */
  limit: number | null;
  reached: number;
  detail: string;
}

export interface CeilingOptions {
  /**
   * Resources this attempt is not bounded by (SCP-230).
   *
   * Counted as they always were — the record says what a run did — and never
   * stopped on. It is a list rather than a very large number because those are
   * different facts: a reader can tell a bound nobody meant from one somebody
   * chose, and a number can be reached by a long enough run either way.
   *
   * The registered direct-agent arm is the caller: it is bounded by its
   * ticket's dollar budget and by a hang guard, and the loop spends that same
   * budget across as many attempts as it needs, so a per-attempt count applied
   * to the arm's one invocation would make it lose a large ticket by
   * construction.
   */
  unbounded?: readonly LimitedResource[];
  /**
   * Which iteration ceiling bounds this invocation, where the repository set
   * one (D-092, D-096).
   *
   * `attempt_iterations`, the default, is an initial attempt: it is building
   * the ticket. `round_iterations` is a remediation round, which closes
   * findings that already name a file and a line and is briefed with the
   * previous attempt's own account. One counter either way — what changes is
   * the ceiling it is tested against and the reason a breach terminates with.
   * Neither is set by default, so unless the repository names one the counter
   * runs on.
   */
  iterations?: Extract<LimitedResource, "attempt_iterations" | "round_iterations">;
}

export class AttemptCeilings {
  private readonly limits: LimitsTable;
  private readonly startedAt: number;
  private readonly clock: () => number;
  private readonly unbounded: ReadonlySet<LimitedResource>;
  private readonly iterationsResource: LimitedResource;
  private commands = 0;
  private iterations = 0;
  private tokens = 0;
  private costMicros = 0;
  private breach: CeilingBreach | null = null;

  constructor(limits: LimitsTable, clock: () => number = Date.now, options: CeilingOptions = {}) {
    this.limits = limits;
    this.clock = clock;
    this.startedAt = clock();
    this.unbounded = new Set(options.unbounded ?? []);
    this.iterationsResource = options.iterations ?? "attempt_iterations";
  }

  private test(resource: LimitedResource, reached: number): CeilingBreach | null {
    if (this.breach) return this.breach;
    if (this.unbounded.has(resource)) return null;
    // A resource the table leaves unset is not tested: `assertWithinLimits`
    // says so too, and this keeps the counting free of a throw nobody catches.
    try {
      assertWithinLimits(this.limits, resource, reached);
      return null;
    } catch (error) {
      if (!(error instanceof LimitExceededError)) throw error;
      this.breach = {
        reason: REASON_FOR[resource],
        resource,
        limit: error.limit ?? limitFor(this.limits, resource),
        reached,
        detail: error.message,
      };
      return this.breach;
    }
  }

  noteCommand(): CeilingBreach | null {
    this.commands += 1;
    return this.test("attempt_commands", this.commands);
  }

  noteIteration(): CeilingBreach | null {
    this.iterations += 1;
    return this.test(this.iterationsResource, this.iterations);
  }

  noteTokens(count: number): CeilingBreach | null {
    this.tokens += count;
    return this.test("attempt_tokens", this.tokens);
  }

  noteCostMicros(micros: number): CeilingBreach | null {
    this.costMicros = micros;
    return this.test("attempt_cost_micros", this.costMicros);
  }

  /** Called on a timer; the wall clock is the ceiling nothing else can reach. */
  tick(): CeilingBreach | null {
    return this.test("attempt_wall_clock_ms", this.clock() - this.startedAt);
  }

  get wallClockLimitMs(): number {
    return limitFor(this.limits, "attempt_wall_clock_ms");
  }

  get costLimitMicros(): number {
    return limitFor(this.limits, "attempt_cost_micros");
  }

  breached(): CeilingBreach | null {
    return this.breach;
  }

  counts(): { commands: number; iterations: number; tokens: number; cost_micros: number; wall_clock_ms: number } {
    return {
      commands: this.commands,
      iterations: this.iterations,
      tokens: this.tokens,
      cost_micros: this.costMicros,
      wall_clock_ms: this.clock() - this.startedAt,
    };
  }
}
