import { createServer } from "node:net";

/**
 * Port allocation per attempt (ADR-0025 §4, SCP-079 criterion 4).
 *
 * Two attempts on the same repository default to the same dev-server port and
 * the second one dies, or worse, talks to the first one's database. So each
 * attempt receives a contiguous range, checked by binding rather than by
 * guessing, and the range is exported into the attempt's environment where the
 * manifest names the variables.
 */

export const DEFAULT_PORT_BASE = 41_000;
export const DEFAULT_PORT_SPAN = 10;

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen({ port, host: "127.0.0.1", exclusive: true });
  });
}

export interface PortRange {
  start: number;
  end: number;
  size: number;
}

export class PortRangeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortRangeUnavailableError";
  }
}

/**
 * The first free contiguous run of `size` ports at or above `base`. Ranges are
 * spaced by `size` so two allocations never interleave.
 */
export async function allocatePortRange(args: {
  size: number;
  base?: number;
  attempts?: number;
  /**
   * Ranges another live attempt holds. Probing alone cannot see them: nothing
   * is bound until the repository's own services start, so two attempts probing
   * at the same moment are both told the same range is free.
   */
  avoid?: ReadonlyArray<{ start: number; end: number }>;
}): Promise<PortRange> {
  const size = args.size;
  if (size === 0) return { start: args.base ?? DEFAULT_PORT_BASE, end: args.base ?? DEFAULT_PORT_BASE, size: 0 };
  const base = args.base ?? DEFAULT_PORT_BASE;
  const tries = args.attempts ?? 64;

  for (let index = 0; index < tries; index += 1) {
    const start = base + index * size;
    const end = start + size - 1;
    if (end > 65_535) break;
    const claimed = (args.avoid ?? []).some((held) => start <= held.end && end >= held.start);
    if (claimed) continue;
    let free = true;
    for (let port = start; port <= end; port += 1) {
      if (!(await portFree(port))) {
        free = false;
        break;
      }
    }
    if (free) return { start, end, size };
  }
  throw new PortRangeUnavailableError(
    `no free run of ${size} ports at or above ${base} after ${tries} probes`,
  );
}

/** A schema name unique to the attempt, where the repository's database has schemas. */
export function databaseSchemaFor(prefix: string, attemptId: string): string {
  return `${prefix}${attemptId.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 63).toLowerCase();
}
