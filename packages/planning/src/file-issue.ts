import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { PlanningError } from "./errors.js";
import type { SourceIssue } from "./issue.js";

/**
 * An issue pasted into a Markdown file, for the work that never reached a
 * tracker: a message, a bug report in a document, a note somebody wrote down.
 *
 * It produces the same shape `fetchGitHubIssue` produces, so drafting cannot
 * tell the two apart and no second path through the model exists — the only
 * differences are the ones a file genuinely has, which is that it carries no
 * issue number and no URL.
 *
 * **The file is `trust="external"` data, exactly as a GitHub issue body is.**
 * Being local makes it convenient, not trusted: the text still arrives from
 * whoever wrote the thing that was pasted, and it reaches the model inside the
 * same delimited block, with the same standing that a body has.
 */

/**
 * The largest file this reads. An issue body is prose; anything past this is a
 * log, a dump or a paste that went wrong, and sending it to a model would spend
 * a context window before failing in a way nobody can read.
 */
export const MAX_ISSUE_FILE_BYTES = 1024 * 1024;

/** The reference a file-sourced issue carries: its base name, never a path. */
export const fileReference = (path: string): string => `file:${basename(path)}`;

/**
 * Split the text: the first line that says anything is the title, the rest is
 * the body.
 *
 * Leading blank lines are skipped rather than taken as an empty title, and a
 * Markdown heading marker on the title line is dropped — `# Users aren't
 * getting the welcome email` is how a person writes a title in a Markdown file,
 * and carrying the `#` into `title_at_admission` would put it in every later
 * rendering of the ticket.
 *
 * The lines dropped on the way are counted, not forgotten: `source_lines` says
 * where in the file the title and the body actually start, so anything that
 * later reports a line — the issue-authored attempt report a person reads
 * before approving — names the line they will find by opening the file.
 */
export function parseIssueMarkdown(text: string, reference: string): SourceIssue {
  // A file written by an editor on Windows, or exported from a tool, arrives
  // with a byte-order mark; it is not part of the title.
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() !== "");
  if (start === -1) {
    throw new PlanningError(
      `${reference} has no text: the first line is the title and everything after it is the body`,
    );
  }
  // The whitespace after the hashes is required, which is also what makes
  // `#412 is broken` keep its number: that is a reference, not a heading.
  const title = lines[start]!.trim().replace(/^#{1,6}\s+/, "").trim();
  // The body begins at the first line after the title that says something: the
  // blank lines between the two belong to neither, and skipping them by index
  // rather than by trimming the joined text is what keeps the count honest.
  let bodyStart = start + 1;
  while (bodyStart < lines.length && lines[bodyStart]!.trim() === "") bodyStart += 1;
  return {
    reference,
    title,
    // The remainder, with trailing whitespace removed. Nothing inside it is touched.
    body: lines.slice(bodyStart).join("\n").trimEnd(),
    source_lines: { title: start + 1, body: bodyStart + 1 },
  };
}

/**
 * Read one Markdown file as an issue. Every failure a person can cause — no
 * file, a directory, an unreadable file, an empty one — is one sentence naming
 * the path, not an `ENOENT` with a stack.
 */
export function readIssueFile(path: string): SourceIssue {
  let bytes: number;
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      throw new PlanningError(`${path} is a directory; --from-file takes one Markdown file`);
    }
    bytes = stat.size;
  } catch (error) {
    if (error instanceof PlanningError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new PlanningError(
      code === "ENOENT"
        ? `no file at ${path}`
        : `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (bytes > MAX_ISSUE_FILE_BYTES) {
    throw new PlanningError(
      `${path} is ${Math.round(bytes / 1024)} KiB, past the ${MAX_ISSUE_FILE_BYTES / 1024} KiB an ` +
        "issue body may be. Paste the issue, not the log it came with",
    );
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new PlanningError(
      `${path} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return parseIssueMarkdown(text, fileReference(path));
}
