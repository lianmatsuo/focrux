import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const desktop = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", desktop), "utf8"));
const version = manifest.devDependencies.node;
const runtime = fileURLToPath(
  new URL(`dist/runtime/${process.platform === "win32" ? "node.exe" : "node"}`, desktop),
);
const options = { encoding: "utf8", timeout: 10_000 };
assert.equal(execFileSync(runtime, ["--version"], options).trim(), `v${version}`);
assert.ok(
  readFileSync(new URL("dist/runtime/LICENSE", desktop)).equals(
    readFileSync(new URL(`licenses/node-${version}-LICENSE.txt`, desktop)),
  ),
  "The bundled license must match the pinned Node runtime license.",
);

const cli = JSON.parse(readFileSync(new URL("../cli/package.json", desktop), "utf8"));
const result = spawnSync(
  runtime,
  [fileURLToPath(new URL("dist/cli/dist/focrux.js", desktop)), "--version"],
  options,
);
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
assert.equal(result.stderr.trim(), `focrux ${cli.version}`);
console.log(`Bundled Node v${version}, its license and CLI v${cli.version} passed.`);
