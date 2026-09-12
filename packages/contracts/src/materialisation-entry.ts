import { z } from "zod";

/** Browser-safe materialization entry contract; no hashing or filesystem imports. */
export const MATERIALIZATION_KINDS = ["file", "directory"] as const;
export const MaterializationKindSchema = z.enum(MATERIALIZATION_KINDS);

/**
 * `copy` duplicates the bytes into the worktree; `symlink` points at the
 * source. A secret is always copied: a symlink into the user's checkout leaves
 * the agent one `readlink` from a path outside the jail.
 */
export const MATERIALIZATION_STRATEGIES = ["copy", "symlink"] as const;
export const MaterializationStrategySchema = z.enum(MATERIALIZATION_STRATEGIES);

export const MaterializationEntrySchema = z
  .strictObject({
    /** Worktree-relative destination. Never absolute, never escaping the root. */
    path: z.string().min(1),
    kind: MaterializationKindSchema,
    /** Absolute, or relative to the declared source checkout. */
    source_path: z.string().min(1),
    strategy: MaterializationStrategySchema,
    /**
     * A secret is copied, hashed, and excluded from every change set, run
     * bundle, log, artifact, telemetry payload and model context by content
     * hash rather than by filename alone (D-012).
     */
    secret: z.boolean(),
    required: z.boolean(),
    reason: z.string().min(1),
  })
  .superRefine((entry, ctx) => {
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
      ctx.addIssue({
        code: "custom",
        path: ["path"],
        message: `materialization destination must stay inside the worktree: ${entry.path}`,
      });
    }
    if (entry.secret && entry.strategy === "symlink") {
      ctx.addIssue({
        code: "custom",
        path: ["strategy"],
        message:
          "a secret is copied, never symlinked: a symlink leaves a readable path outside the jail",
      });
    }
  });
export type MaterializationEntry = z.infer<typeof MaterializationEntrySchema>;
