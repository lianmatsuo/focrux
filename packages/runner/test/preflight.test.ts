import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { preflight } from "../src/preflight.js";
import { SPAWN_TEST_TIMEOUT_MS } from "./support.js";

/** An environment whose PATH holds nothing, so every binary check fails. */
function bare(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: mkdtempSync(join(tmpdir(), "focrux-preflight-empty-")), ...extra };
}

describe("preflight", () => {
  it("warns about a missing gh when the run does not publish, and blocks when it does", () => {
    const quiet = preflight({
      agentBinary: null,
      reviewerProvider: "anthropic",
      needsGh: false,
      needsGit: false,
      env: bare({ ANTHROPIC_API_KEY: "set" }),
    });
    expect(quiet.ok).toBe(true);
    expect(quiet.findings.map((f) => [f.reason, f.severity])).toEqual([["gh_missing", "warning"]]);
    expect(quiet.tools.gh?.present).toBe(false);

    const publishing = preflight({
      agentBinary: null,
      reviewerProvider: "anthropic",
      needsGh: true,
      needsGit: false,
      env: bare({ ANTHROPIC_API_KEY: "set" }),
    });
    expect(publishing.ok).toBe(false);
    expect(publishing.findings.map((f) => [f.reason, f.severity])).toEqual([["gh_missing", "blocking"]]);
  });

  it("names the credential a reviewer provider needs, with its fix", () => {
    const result = preflight({
      agentBinary: null,
      reviewerProvider: "anthropic",
      needsGh: false,
      needsGit: false,
      env: bare(),
    });
    const credential = result.findings.find((f) => f.reason === "reviewer_credential_missing");
    expect(credential?.severity).toBe("blocking");
    expect(credential?.fix).toContain("ANTHROPIC_API_KEY");
  });

  it("blocks on a missing agent binary and git when the run needs them", () => {
    const result = preflight({
      agentBinary: "claude",
      reviewerProvider: "claude-cli",
      needsGh: false,
      env: bare(),
    });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.reason)).toEqual(
      expect.arrayContaining(["git_missing", "agent_binary_missing"]),
    );
  });

  it("blocks on the binary the manifest installs with, and names it in the tools", () => {
    const result = preflight({
      agentBinary: null,
      reviewerProvider: "anthropic",
      needsGh: false,
      installBinary: "pnpm",
      env: bare({ ANTHROPIC_API_KEY: "set" }),
    });
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.reason === "install_binary_missing");
    expect(finding?.severity).toBe("blocking");
    expect(finding?.detail).toContain("pnpm");
    // The row is what a person pastes into an issue; a binary checked and not
    // reported is a check nobody can read.
    expect(result.tools.pnpm?.present).toBe(false);
  });

  it("asks nothing about an install a run without a worktree never performs", () => {
    const result = preflight({
      agentBinary: null,
      reviewerProvider: "anthropic",
      needsGh: false,
      needsGit: false,
      installBinary: "pnpm",
      env: bare({ ANTHROPIC_API_KEY: "set" }),
    });
    expect(result.findings.map((f) => f.reason)).not.toContain("install_binary_missing");
    expect(result.tools.pnpm).toBeUndefined();
  });

  it("passes when the install binary can actually be spawned", () => {
    // `node` stands in for the manifest's package manager: a real executable,
    // found the same argv-only way the runner will spawn the install itself.
    const result = preflight({
      agentBinary: null,
      reviewerProvider: "anthropic",
      needsGh: false,
      installBinary: process.execPath,
      env: { ...process.env, ANTHROPIC_API_KEY: "set" },
    });
    expect(result.findings.map((f) => f.reason)).not.toContain("install_binary_missing");
    expect(result.tools[process.execPath]?.present).toBe(true);
  });
}, SPAWN_TEST_TIMEOUT_MS);
