import { createHash } from "node:crypto";
import { z } from "zod";
import { AttemptIdSchema, ChangeSetIdSchema, CommitShaSchema } from "./ids.js";

export const CHANGE_KINDS = ["added", "modified", "deleted", "renamed"] as const;
export const ChangeKindSchema = z.enum(CHANGE_KINDS);
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const FileChangeSchema = z.strictObject({
  path: z.string().min(1),
  previous_path: z.string().min(1).nullable(),
  change_kind: ChangeKindSchema,
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  /** The unified diff for this file, verbatim. Untrusted: `trust: repo`. */
  patch: z.string(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

/**
 * The largest diff body the reviewer is handed whole. A change set past it is
 * sealed with its complete file list and no patches, marked `truncated`, and
 * refused deterministically rather than judged from whatever prefix survived.
 */
export const MAX_REVIEWABLE_DIFF_BYTES = 8 * 1024 * 1024;

/**
 * One commit of a change set, with the attempt that sealed it.
 *
 * `attempt_id` is null where no attempt record naming that commit is on hand.
 * The attempts file is appended to by every run of a ticket, so a commit an
 * earlier run sealed is still attributed to the attempt that made it; a commit
 * from a record that was moved, removed or made by hand is identified by its
 * sha alone.
 */
export const SealedCommitSchema = z.strictObject({
  sha: CommitShaSchema,
  attempt_id: AttemptIdSchema.nullable(),
});
export type SealedCommit = z.infer<typeof SealedCommitSchema>;

/**
 * A change set is identified by `(base_commit, head_commit)`. A rebase produces
 * a different pair, so a verdict targeting the prior one is superseded
 * (docs/04, "Review validity").
 */
export const ChangeSetSchema = z.strictObject({
  changeset_id: ChangeSetIdSchema,
  base_commit: CommitShaSchema,
  head_commit: CommitShaSchema,
  /**
   * Where `head_commit` came from. Stage 1 has no runner, so a diff supplied on
   * the command line has no commit behind it; `diff_digest` records that the
   * head is the digest of the diff bytes rather than a real commit. The
   * supersession property still holds — different bytes, different pair.
   */
  head_commit_source: z.enum(["recorded", "diff_digest"]),
  files: z.array(FileChangeSchema),
  /**
   * True when the diff body exceeded `MAX_REVIEWABLE_DIFF_BYTES` and was
   * withheld rather than cut. `files` is still complete — a sealed change set
   * lists them from `git diff --name-status`, never from the diff — so scope is
   * decided over every changed path; only the patches are absent.
   */
  truncated: z.boolean().default(false),
  /** The diff body's size in bytes where it was measured; null where it was not. */
  diff_bytes: z.number().int().min(0).nullable().default(null),
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

const HUNK_HEADER = /^@@ /;

function stripPrefix(path: string): string {
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  return path
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Parse `git diff` output into file changes.
 *
 * Deliberately narrow: it reads `diff --git` headers, rename and mode lines,
 * and counts hunk body lines. It does not attempt to apply anything. Binary
 * files appear with a zero line count and their header text as the patch.
 */
export function parseUnifiedDiff(diff: string): FileChange[] {
  const lines = diff.split("\n");
  const files: FileChange[] = [];

  let current: {
    header: string[];
    body: string[];
    aPath: string | null;
    bPath: string | null;
    renameFrom: string | null;
    renameTo: string | null;
    isNew: boolean;
    isDeleted: boolean;
    additions: number;
    deletions: number;
    inHunk: boolean;
  } | null = null;

  const flush = () => {
    if (!current) return;
    const from = current.renameFrom ?? current.aPath;
    const to = current.renameTo ?? current.bPath;
    const path = to && to !== "/dev/null" ? to : (from ?? "");
    if (path === "" || path === "/dev/null") {
      current = null;
      return;
    }
    const renamed = current.renameFrom !== null && current.renameFrom !== current.renameTo;
    const change_kind: ChangeKind = current.isNew
      ? "added"
      : current.isDeleted
        ? "deleted"
        : renamed
          ? "renamed"
          : "modified";
    files.push({
      path,
      previous_path: renamed ? current.renameFrom : null,
      change_kind,
      additions: current.additions,
      deletions: current.deletions,
      patch: [...current.header, ...current.body].join("\n"),
    });
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = /^diff --git (".*?"|\S+) (".*?"|\S+)$/.exec(line);
      current = {
        header: [line],
        body: [],
        aPath: match?.[1] ? stripPrefix(unquote(match[1])) : null,
        bPath: match?.[2] ? stripPrefix(unquote(match[2])) : null,
        renameFrom: null,
        renameTo: null,
        isNew: false,
        isDeleted: false,
        additions: 0,
        deletions: 0,
        inHunk: false,
      };
      continue;
    }
    if (!current) continue;

    if (!current.inHunk) {
      if (line.startsWith("new file mode")) current.isNew = true;
      else if (line.startsWith("deleted file mode")) current.isDeleted = true;
      else if (line.startsWith("rename from ")) current.renameFrom = unquote(line.slice(12));
      else if (line.startsWith("rename to ")) current.renameTo = unquote(line.slice(10));
      else if (line.startsWith("--- ")) current.aPath = stripPrefix(unquote(line.slice(4)));
      else if (line.startsWith("+++ ")) current.bPath = stripPrefix(unquote(line.slice(4)));
    }

    if (HUNK_HEADER.test(line)) {
      current.inHunk = true;
      current.body.push(line);
      continue;
    }

    if (current.inHunk) {
      if (line.startsWith("+")) current.additions += 1;
      else if (line.startsWith("-")) current.deletions += 1;
      current.body.push(line);
      continue;
    }

    current.header.push(line);
  }
  flush();
  return files;
}

/**
 * Parse `git diff --name-status -z` output into file changes with no patch.
 *
 * NUL-separated: a status letter (with a similarity score on renames and
 * copies), the path, and for `R`/`C` a second path. This is the complete list
 * of what changed whatever the diff's size, which is why a sealed change set
 * takes its files from here rather than from the parsed diff.
 */
export function parseNameStatus(output: string): FileChange[] {
  const tokens = output.split("\0");
  const files: FileChange[] = [];
  const entry = (path: string, change_kind: ChangeKind, previous_path: string | null): FileChange => ({
    path,
    previous_path,
    change_kind,
    additions: 0,
    deletions: 0,
    patch: "",
  });
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i] ?? "";
    if (status === "") {
      i += 1;
      continue;
    }
    const code = status[0];
    if (code === "R" || code === "C") {
      const from = tokens[i + 1] ?? "";
      const to = tokens[i + 2] ?? "";
      i += 3;
      if (to === "") continue;
      files.push(code === "R" ? entry(to, "renamed", from) : entry(to, "added", null));
      continue;
    }
    const path = tokens[i + 1] ?? "";
    i += 2;
    if (path === "") continue;
    files.push(entry(path, code === "A" ? "added" : code === "D" ? "deleted" : "modified", null));
  }
  return files;
}

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const changeSetId = (base_commit: string, head_commit: string) =>
  `cs_${sha256Hex(`${base_commit}|${head_commit}`).slice(0, 16)}`;

/**
 * Build a change set from a diff and the base commit the plan pinned.
 *
 * `head_commit` is the sha256 of the diff bytes when no real head is supplied.
 * That keeps the `(base, head)` pair meaningful — edit the change and the pair
 * moves, which is exactly what supersedes a prior verdict — without requiring a
 * git repository that Stage 1 does not have.
 */
export function changeSetFromDiff(args: {
  diff: string;
  base_commit: string;
  head_commit?: string | undefined;
}): ChangeSet {
  const files = parseUnifiedDiff(args.diff);
  const head_commit = args.head_commit ?? sha256Hex(args.diff).slice(0, 40);
  return ChangeSetSchema.parse({
    changeset_id: changeSetId(args.base_commit, head_commit),
    base_commit: args.base_commit,
    head_commit,
    head_commit_source: args.head_commit ? "recorded" : "diff_digest",
    files,
    diff_bytes: Buffer.byteLength(args.diff, "utf8"),
  });
}

/**
 * Build a sealed change set: the file list from `git diff --name-status` is
 * authoritative and complete, and the diff — when it is small enough to be
 * handed over at all — supplies the patch and line counts for the files it
 * reached. A path the diff parser dropped keeps its entry with an empty patch,
 * so scope is never decided over a prefix of the change. `diff: null` means the
 * body exceeded the cap and was withheld; the change set is then `truncated`.
 */
export function changeSetFromNameStatus(args: {
  files: readonly FileChange[];
  diff: string | null;
  diff_bytes: number;
  base_commit: string;
  head_commit: string;
}): ChangeSet {
  const parsed = new Map(
    (args.diff === null ? [] : parseUnifiedDiff(args.diff)).map((file) => [file.path, file]),
  );
  const files = args.files.map((file) => parsed.get(file.path) ?? file);
  const listed = new Set(files.map((file) => file.path));
  for (const [path, file] of parsed) {
    if (!listed.has(path)) files.push(file);
  }
  return ChangeSetSchema.parse({
    changeset_id: changeSetId(args.base_commit, args.head_commit),
    base_commit: args.base_commit,
    head_commit: args.head_commit,
    head_commit_source: "recorded",
    files,
    truncated: args.diff === null,
    diff_bytes: args.diff_bytes,
  });
}
