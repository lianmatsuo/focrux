import { readdirSync, statSync, statfsSync } from "node:fs";
import { join, toNamespacedPath } from "node:path";

/**
 * Disk, measured rather than estimated (SCP-079 criterion 7, D-049).
 *
 * Two numbers, because they answer different questions and a single figure
 * would be wrong for one of them:
 *
 * - **Free-space delta** is what actually fills a laptop. It accounts for
 *   hardlinks into a shared package store and for copy-on-write clones, both of
 *   which a directory walk gets badly wrong — a pnpm `node_modules` is mostly
 *   links, and a walk bills the linked blocks to the worktree.
 * - **Directory size** is the upper bound: what the worktree would cost on a
 *   filesystem with neither.
 *
 * Free-space delta is noisy on a machine doing other work. It is reported with
 * that caveat rather than smoothed, because smoothing it would hide the noise
 * rather than the effect.
 */

export function freeBytes(path: string): number {
  const stats = statfsSync(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

/**
 * The second number above: every file counted at its own length, which is what
 * the tree would cost on a filesystem with neither hardlinks nor copy-on-write.
 * Walked in this process rather than measured by `du`, which Windows does not
 * have.
 *
 * A link is a name rather than a copy, so it is counted at neither its own
 * length nor its target's and is not descended into: a pnpm `node_modules` is
 * mostly links into the store beside it, and following them would count that
 * store once per package that references it. What the links point at is
 * counted where it actually lives. An entry that cannot be read, or that
 * vanishes mid-walk, is skipped rather than thrown: the number is only ever
 * reported, and an attempt must not end on a measurement.
 */
export function directoryBytes(path: string): number {
  let total = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(toNamespacedPath(dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      try {
        total += statSync(toNamespacedPath(full)).size;
      } catch {
        // Gone between the readdir and the stat.
      }
    }
  };
  walk(path);
  return total;
}

export class DiskWatcher {
  private readonly path: string;
  private readonly intervalMs: number;
  private readonly start: number;
  private lowest: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(path: string, intervalMs = 500) {
    this.path = path;
    this.intervalMs = intervalMs;
    this.start = freeBytes(path);
    this.lowest = this.start;
  }

  sample(): void {
    const free = freeBytes(this.path);
    if (free < this.lowest) this.lowest = free;
  }

  watch(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): { steady_state_bytes: number; peak_bytes: number } {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sample();
    return {
      steady_state_bytes: Math.max(0, this.start - freeBytes(this.path)),
      peak_bytes: Math.max(0, this.start - this.lowest),
    };
  }
}
