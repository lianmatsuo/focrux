import { readFileSync } from "node:fs";
import { failClosed, runPreToolHook } from "./pretool.js";

/**
 * The `PreToolUse` hook the adapter installs, as a program (SCP-177).
 *
 * Claude Code runs it once per Bash, Write, Edit, MultiEdit and NotebookEdit
 * call, before the tool: the call arrives as JSON on stdin and the decision
 * goes back as JSON on stdout. The guard's directory is the one argument.
 *
 * It exits 0 whatever happens. A non-zero exit other than 2 is a non-blocking
 * hook error, which runs the tool — so the only safe way to fail is to print a
 * refusal and leave.
 */

function main(): void {
  const directory = process.argv[2];
  if (directory === undefined) {
    process.stdout.write(
      JSON.stringify(failClosed("the runner's write guard was started without its state directory")),
    );
    return;
  }
  let stdin = "";
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    // No tool call to judge, so there is nothing to admit.
  }
  const response = runPreToolHook(directory, stdin);
  // Nothing printed is the third answer: the runner has no grounds either way
  // and the agent's own permission layer decides, as it did before this hook.
  if (response !== null) process.stdout.write(JSON.stringify(response));
}

try {
  main();
} catch (error) {
  process.stdout.write(
    JSON.stringify(
      failClosed(
        `the runner's write guard failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ),
  );
}
process.exitCode = 0;
