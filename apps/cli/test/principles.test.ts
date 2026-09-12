import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePrincipleArgs, principlesPath, runPrincipleCommand } from "../src/principles.js";

describe("focrux principle (D-065's ratchet)", () => {
  it("records an answer once and appends the next beneath it", () => {
    const repo = mkdtempSync(join(tmpdir(), "focrux-principles-"));
    const args = parsePrincipleArgs(["add", "focrux list shows open tickets by default.", "--repo", repo]);
    runPrincipleCommand(args);
    runPrincipleCommand(parsePrincipleArgs(["add", "Header detection is generic, never enumerated.", "--repo", repo]));
    const text = readFileSync(principlesPath(args), "utf8");
    expect(text).toContain("# Product principles");
    expect(text).toContain("focrux list shows open tickets by default.");
    expect(text).toContain("Header detection is generic, never enumerated.");
  });

  it("refuses an add with no text", () => {
    expect(() => parsePrincipleArgs(["add"])).toThrow(/text/);
  });

  it("writes into the ticket store directory", () => {
    const args = parsePrincipleArgs(["add", "x", "--repo", "/tmp/some-repo"]);
    expect(principlesPath(args)).toBe("/tmp/some-repo/.focrux/principles.md");
  });
});
