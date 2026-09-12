import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";
import {
  copyFile,
  mkdir,
  writeFile,
  readFile,
  rename,
  chmod,
} from "node:fs/promises";

await mkdir("dist/runtime", { recursive: true });
const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimeTemporary = `dist/runtime/${runtimeName}.${process.pid}`;
const require = createRequire(import.meta.url);
const runtimeSource = require.resolve(`node/bin/${runtimeName}`);
if (
  execFileSync(runtimeSource, ["--version"], { encoding: "utf8" }).trim() !==
  "v22.22.0"
)
  throw new Error(
    "The desktop requires the pinned Node 22.22.0 runtime. Run pnpm install.",
  );
await copyFile(runtimeSource, runtimeTemporary);
await copyFile(
  new URL("../licenses/node-22.22.0-LICENSE.txt", import.meta.url),
  "dist/runtime/LICENSE",
);
await chmod(runtimeTemporary, 0o755);
await rename(runtimeTemporary, `dist/runtime/${runtimeName}`);
await mkdir("dist/host", { recursive: true });
await build({
  entryPoints: ["src/host/main.ts"],
  outfile: "dist/host/main.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/host/preload.ts"],
  outfile: "dist/host/preload.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
});
await mkdir("dist/cli/dist", { recursive: true });
for (const name of ["focrux.js", "guard-hook.js"])
  await copyFile(`../cli/dist/${name}`, `dist/cli/dist/${name}`);
const cli = JSON.parse(await readFile("../cli/package.json", "utf8"));
await writeFile(
  "dist/cli/package.json",
  JSON.stringify({ name: cli.name, version: cli.version, type: "module" }),
);
await buildRenderer();
