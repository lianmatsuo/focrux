import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hasAcceptanceCriteria } from "@focrux/contracts";
import { UsageError } from "../src/args.js";
import { parseAdmitArgs, runAdmitCommand, runApproveCommand, type Streams } from "../src/admit.js";
import { runEditCommand } from "../src/edit.js";
import { contractPathFor, readContract, readTicket, storeDir } from "../src/tickets.js";
import { SPAWN_TEST_TIMEOUT_MS } from "./spawn-timeout.js";

const scratch = mkdtempSync(join(tmpdir(), "focrux-edit-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function repository(name: string): string {
  const dir = join(scratch, name);
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "base"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t.invalid",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  return dir;
}

function capture(): Streams & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (chunk) => out.push(chunk), stderr: (chunk) => err.push(chunk), isTTY: false };
}

function admitted(name: string, path = "packages/search/**", ...extra: string[]): { repo: string; dir: string } {
  const repo = repository(name);
  runAdmitCommand({
    args: parseAdmitArgs([
      "--repo", repo,
      "--outcome", "Search results are paginated.",
      "--criterion", "A search returns at most 25 hits per page. :: a 140-hit query returns 25",
      "--path", path,
      ...extra,
    ]),
    streams: capture(),
    cwd: repo,
  });
  return { repo, dir: storeDir(repo, null) };
}

/**
 * An "editor" that is `node <script>`: the whitespace in EDITOR is the split
 * the command has to make, and the contract path arrives as the last argument
 * exactly as an editor would receive it.
 */
function editorThat(name: string, body: string): string {
  const script = join(scratch, `${name}.js`);
  writeFileSync(
    script,
    `const fs = require("node:fs");\nconst file = process.argv[process.argv.length - 1];\n${body}\n`,
  );
  return `node ${script}`;
}

const rewrite = (name: string, mutate: string) =>
  editorThat(
    name,
    `const c = JSON.parse(fs.readFileSync(file, "utf8"));\n${mutate}\nfs.writeFileSync(file, JSON.stringify(c, null, 2));`,
  );

const edit = (repo: string, editor: string | null, ...argv: string[]) =>
  runEditCommand({
    argv: ["FCX-1", "--repo", repo, ...argv],
    streams: capture(),
    cwd: repo,
    env: editor === null ? {} : { EDITOR: editor },
  });

describe("focrux edit", () => {
  it("refuses an approved contract: it is immutable (ADR-0016)", async () => {
    const { repo } = admitted("edit-approved", "packages/search/**", "--approve");
    await expect(edit(repo, null, "--outcome", "x")).rejects.toThrow(/immutable \(ADR-0016\)/);
  });

  it("refuses without an editor, and says how to set one", async () => {
    const { repo, dir } = admitted("edit-no-editor");
    const before = readFileSync(contractPathFor(dir, "FCX-1"), "utf8");
    await expect(edit(repo, null)).rejects.toThrow(/VISUAL or EDITOR/);
    expect(readFileSync(contractPathFor(dir, "FCX-1"), "utf8")).toBe(before);
  });

  it("opens the contract in $EDITOR by argv, re-validates it and derives the level again", async () => {
    const { repo, dir } = admitted("edit-interactive");
    const before = readContract(dir, "FCX-1");
    const editor = rewrite(
      "grow-scope",
      'c.outcome = "Search results are paginated at 25 per page.";\nc.scope.paths_allowed.push("packages/auth/**");',
    );
    expect(await edit(repo, editor)).toBe(0);

    const after = readContract(dir, "FCX-1");
    expect(after.outcome).toBe("Search results are paginated at 25 per page.");
    expect(after.scope.paths_allowed).toEqual(["packages/search/**", "packages/auth/**"]);
    // auth arrived in the scope, so the contract is P2 whatever the file said.
    expect(before.level).toBe("P1");
    expect(after.level).toBe("P2");
    expect(after.base.context_manifest_hash).not.toBe(before.base.context_manifest_hash);
    expect(after.base.base_commit).toBe(before.base.base_commit);

    const ticket = readTicket(dir, "FCX-1");
    expect(ticket.title).toBe(after.outcome);
    expect(ticket.admission.derived_level).toBe("P2");
    expect(ticket.state).toBe("plan_review");
  });

  it("leaves a contract that no longer parses as edited, listing the issues", async () => {
    const { repo, dir } = admitted("edit-broken");
    const editor = editorThat("break-it", 'fs.writeFileSync(file, JSON.stringify({ plan_id: "plan_x", nonsense: true }));');
    await expect(edit(repo, editor)).rejects.toThrow(UsageError);
    await expect(edit(repo, editor)).rejects.toThrow(/no longer parses[\s\S]*focrux edit FCX-1 again/);
    expect(JSON.parse(readFileSync(contractPathFor(dir, "FCX-1"), "utf8"))).toEqual({
      plan_id: "plan_x",
      nonsense: true,
    });
  });

  it("opens a contract an earlier edit broke, so the person can fix it there", async () => {
    const { repo, dir } = admitted("edit-repair");
    const good = readFileSync(contractPathFor(dir, "FCX-1"), "utf8");
    await expect(
      edit(repo, editorThat("break-first", 'fs.writeFileSync(file, "{ not json");')),
    ).rejects.toThrow(/not JSON/);
    // Without an editor there is nothing to fix it with, and the command says so.
    await expect(edit(repo, null, "--outcome", "x")).rejects.toThrow(/does not parse after an earlier edit/);
    // With one, the broken file opens and the repaired contract is accepted.
    const restore = editorThat("restore", `fs.writeFileSync(file, ${JSON.stringify(good)});`);
    expect(await edit(repo, restore)).toBe(0);
    expect(readContract(dir, "FCX-1").outcome).toBe("Search results are paginated.");
  });

  it("leaves a file that is not JSON as edited", async () => {
    const { repo, dir } = admitted("edit-not-json");
    const editor = editorThat("not-json", 'fs.writeFileSync(file, "{ not json");');
    await expect(edit(repo, editor)).rejects.toThrow(/not JSON/);
    expect(readFileSync(contractPathFor(dir, "FCX-1"), "utf8")).toBe("{ not json");
  });

  it("refuses an edit that moves the contract's identity", async () => {
    const { repo } = admitted("edit-identity");
    const editor = rewrite("move-id", 'c.plan_id = "plan_somebodyelse";');
    await expect(edit(repo, editor)).rejects.toThrow(/plan_id/);
  });

  it("refuses a level in the file below the derivation (D-010)", async () => {
    const { repo } = admitted("edit-lower", "packages/auth/**");
    const editor = rewrite("lower", 'c.level = "P1"; for (const k of ["data_impact","security_impact","rollout","rollback","estimated_recurring_cost_micros"]) delete c[k];');
    await expect(edit(repo, editor)).rejects.toThrow(/A human may raise either level; a human may not lower it/);
  });

  it("lets a person state a P3's decisions in the editor, after which approve signs it", async () => {
    const { repo, dir } = admitted("edit-p3", ".github/workflows/**");
    expect(() => runApproveCommand({ argv: ["FCX-1", "--repo", repo], streams: capture(), cwd: repo }))
      .toThrow(/not yet stated/);
    const editor = rewrite(
      "state-p3",
      'c.named_approver = "lian"; c.alternatives = ["leave CI as it is"]; c.contingency = "revert the workflow change";',
    );
    expect(await edit(repo, editor)).toBe(0);
    expect(runApproveCommand({ argv: ["FCX-1", "--repo", repo], streams: capture(), cwd: repo })).toBe(0);
    const contract = readContract(dir, "FCX-1");
    if (contract.level !== "P3") throw new Error(`expected P3, got ${contract.level}`);
    expect(contract.named_approver).toBe("lian");
    expect(readTicket(dir, "FCX-1").state).toBe("ready");
  });

  it("edits without an editor: --outcome, --criterion and --path each replace their part", async () => {
    const { repo, dir } = admitted("edit-flags");
    const streams = capture();
    const code = await runEditCommand({
      argv: [
        "FCX-1", "--repo", repo,
        "--outcome", "Search is paginated and counted.",
        "--criterion", "The total is reported. :: total is 140 :: query",
        "--criterion", "Paging past the end is empty. :: page 7 of 140 is []",
        "--path", "packages/search/**", "--path", "packages/api/**",
      ],
      streams,
      cwd: repo,
      env: {},
    });
    expect(code).toBe(0);
    const contract = readContract(dir, "FCX-1");
    if (!hasAcceptanceCriteria(contract)) throw new Error("no criteria");
    expect(contract.outcome).toBe("Search is paginated and counted.");
    expect(contract.acceptance_criteria.map((c) => c.expected_verification.kind)).toEqual(["query", "test"]);
    expect(contract.scope.paths_allowed).toEqual(["packages/search/**", "packages/api/**"]);
    // Two packages now: derived P2, said so.
    expect(contract.level).toBe("P2");
    expect(streams.err.join("")).toContain("P1 -> P2");
    expect(streams.err.join("")).toContain("focrux approve FCX-1");
  });
}, SPAWN_TEST_TIMEOUT_MS);
