import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import { sampleDir } from "./sample-fixtures.js";

/**
 * `--dry-run` names the thing the harness already did by default: list the
 * selection and spend nothing.
 *
 * The default has always been the dry listing and `--run` the flag that spends,
 * which is safe but silent — a reader following SCORING.md has to know that the
 * absence of a flag is the safe path. Saying it out loud costs one flag, and
 * asking for both at once is a contradiction rather than a precedence rule.
 */

/** Runs the command with stdout and stderr captured rather than printed. */
async function say(argv: string[]): Promise<{ code: number; said: string }> {
  const said: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    said.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    said.push(String(chunk));
    return true;
  });
  const code = await main(argv);
  return { code, said: said.join("") };
}

afterEach(() => vi.restoreAllMocks());

describe("--dry-run lists the selection and spends nothing", () => {
  it("lists the sample and says what a run would cost in model calls", async () => {
    const { code, said } = await say(["--corpus", sampleDir, "--dry-run"]);
    expect(code).toBe(0);
    expect(said).toContain("req-001-reset-token-single-use");
    expect(said).toContain("Pass --run to invoke the reviewer");
  });

  it("narrows with --filter exactly as a live run would", async () => {
    const { code, said } = await say(["--corpus", sampleDir, "--dry-run", "--filter", "sec-006"]);
    expect(code).toBe(0);
    expect(said).toContain("sec-006-idor-in-attachment-download");
    expect(said).not.toContain("req-001-reset-token-single-use");
  });

  it("refuses --run and --dry-run together rather than picking one", async () => {
    await expect(say(["--corpus", sampleDir, "--dry-run", "--run"])).rejects.toThrow(
      /--dry-run and --run ask for opposite things/,
    );
  });
});
