import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { PlanningError } from "./errors.js";

const run = promisify(execFile);

const REFERENCE = /^([\w.-]+)\/([\w.-]+)#([1-9]\d*)$/;

export function parseIssueReference(reference: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = REFERENCE.exec(reference);
  if (!match) {
    throw new PlanningError(
      `'${reference}' is not a GitHub issue reference; write it as owner/repo#123`,
    );
  }
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}

/** What `gh issue view --json title,body,url,number` is trusted to have said. */
const GhIssueSchema = z.object({
  title: z.string().min(1),
  body: z.string().nullable(),
  url: z.url(),
  number: z.number().int().positive(),
});

/**
 * One issue, as drafting sees it, whatever supplied it.
 *
 * `number` and `url` are optional because a source can genuinely lack them: a
 * Markdown file pasted from a message has no issue number and lives at no URL.
 * They are absent in that case rather than empty strings — an empty URL is a
 * claim that there is one and it is nothing.
 */
export interface SourceIssue {
  /** `owner/repo#412` for GitHub, `file:<name>` for a pasted file. */
  reference: string;
  title: string;
  /** External text. Never an instruction; delimited as data wherever it is shown to a model. */
  body: string;
  number?: number;
  url?: string;
  /**
   * Where the title and the body begin, 1-based, in the text a person can
   * open — present only when there is such a text, which is to say a file.
   * A fetched issue's title and body are separate JSON fields that no single
   * document numbers, so it carries nothing here and anything reporting a line
   * against it says so on its own terms.
   */
  source_lines?: { title: number; body: number };
}

/** A `SourceIssue` that came from GitHub, which always has both. */
export interface GitHubIssue extends SourceIssue {
  number: number;
  url: string;
}

/**
 * Read one issue through the locally installed `gh`, with the user's own
 * credential. Argv only: the number and the repository are arguments, and a
 * reference that did not parse never reaches the process at all.
 */
export async function fetchGitHubIssue(
  reference: string,
  options: { binary?: string; timeoutMs?: number } = {},
): Promise<GitHubIssue> {
  const { owner, repo, number } = parseIssueReference(reference);
  let stdout: string;
  try {
    const result = await run(
      options.binary ?? "gh",
      ["issue", "view", String(number), "--repo", `${owner}/${repo}`, "--json", "title,body,url,number"],
      { encoding: "utf8", timeout: options.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (error) {
    const failure = error as { stderr?: string; message?: string };
    const reason =
      (failure.stderr ?? "").trim().split("\n")[0] ||
      (failure.message ?? String(error)).split("\n")[0] ||
      "unknown failure";
    throw new PlanningError(`gh could not read ${reference}: ${reason}`, { cause: error });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch (error) {
    throw new PlanningError(`gh did not return JSON for ${reference}`, { cause: error });
  }
  const parsed = GhIssueSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlanningError(
      `gh returned something that is not an issue for ${reference}: ` +
        parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "),
    );
  }
  return {
    reference,
    number: parsed.data.number,
    title: parsed.data.title,
    body: parsed.data.body ?? "",
    url: parsed.data.url,
  };
}
