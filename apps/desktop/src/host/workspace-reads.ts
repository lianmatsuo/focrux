/** Shares concurrent native reads; a mutation during a read requires a fresh pass. */
export class WorkspaceReads {
  private readonly generations = new Map<string, number>();
  private readonly pending = new Map<string, Promise<unknown>>();
  invalidate(scope: string): void {
    this.generations.set(scope, (this.generations.get(scope) ?? 0) + 1);
    this.generations.set("snapshot", (this.generations.get("snapshot") ?? 0) + 1);
  }
  async read<T>(key: string, scope: string, load: () => Promise<T>): Promise<T> {
    let work = this.pending.get(key);
    if (!work) {
      work = (async () => {
        for (;;) {
          const generation = this.generations.get(scope), all = this.generations.get("all");
          try {
            const result = await load();
            if (generation === this.generations.get(scope) && all === this.generations.get("all")) return result;
          } catch (error) {
            if (generation === this.generations.get(scope) && all === this.generations.get("all")) throw error;
          }
        }
      })();
      this.pending.set(key, work);
      const clear = (): void => { if (this.pending.get(key) === work) this.pending.delete(key); };
      void work.then(clear, clear);
    }
    return structuredClone(await work) as T;
  }
}
