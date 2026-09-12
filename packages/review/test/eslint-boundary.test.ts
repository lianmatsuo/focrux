import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The reviewer's execution surface, as the lint configuration actually
 * enforces it: process execution is banned everywhere under `packages/review`
 * except in the two named CLI transports, and the shell-string ban holds even
 * there. Checked by linting a fixture rather than by reading the config, so a
 * widened glob fails a test instead of a review.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const eslint = new ESLint({ cwd: root });

async function messagesFor(relativePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: join(root, relativePath) });
  return (result?.messages ?? []).map((message) => message.message);
}

const EXEC_FILE = 'import { execFile } from "node:child_process";\nexecFile("claude", ["-p"]);\n';
const SHELL_STRING = 'import { exec } from "node:child_process";\nexec("claude -p");\n';

const TRANSPORTS = [
  "packages/review/src/provider-cli.ts",
  "packages/review/src/provider-codex-cli.ts",
];

describe("the reviewer's execution boundary", () => {
  it("bans process execution in every other reviewer file", async () => {
    for (const path of [
      "packages/review/src/review.ts",
      "packages/review/src/some-new-file.ts",
      "packages/review/src/nested/provider-cli.ts",
    ]) {
      expect(await messagesFor(path, EXEC_FILE), path).toContainEqual(
        expect.stringContaining("No process execution in the reviewer"),
      );
    }
  }, 30_000);

  it("exempts exactly the two named transports from the execution ban", async () => {
    for (const path of TRANSPORTS) {
      expect(await messagesFor(path, EXEC_FILE), path).not.toContainEqual(
        expect.stringContaining("No process execution"),
      );
    }
  }, 30_000);

  it("keeps the shell-string ban inside the transports", async () => {
    for (const path of TRANSPORTS) {
      expect(await messagesFor(path, SHELL_STRING), path).toContainEqual(
        expect.stringContaining("No shell-string execution"),
      );
    }
  }, 30_000);
});
