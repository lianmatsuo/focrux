import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});

it("builds the runtime when the Windows npm package contains no license", () => {
  const root = mkdtempSync(join(tmpdir(), "focrux Windows build "));
  temporary.push(root);
  const app = join(root, "apps", "desktop");
  const put = (path: string, contents: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  const runtime = createRequire(import.meta.url).resolve(
    `node/bin/${process.platform === "win32" ? "node.exe" : "node"}`,
  );
  put(join(app, "scripts", "entry.mjs"), `
import "node:child_process";
Object.defineProperty(process, "platform", { value: "win32" });
Object.defineProperty(process, "arch", { value: "x64" });
await import("./build.mjs");
`);
  copyFileSync(
    join(desktop, "scripts", "build.mjs"),
    join(app, "scripts", "build.mjs"),
  );
  cpSync(join(desktop, "licenses"), join(app, "licenses"), { recursive: true });
  put(
    join(app, "node_modules", "node", "package.json"),
    '{"name":"node","version":"22.22.0"}',
  );
  const platformPackage = join(app, "node_modules", "node", "node_modules", "node-win-x64");
  put(
    join(platformPackage, "package.json"),
    '{"name":"node-win-x64","version":"22.22.0","bin":{"node":"bin/node.exe"}}',
  );
  mkdirSync(join(platformPackage, "bin"));
  copyFileSync(runtime, join(platformPackage, "bin", "node.exe"));
  mkdirSync(join(app, "node_modules", "node", "bin"));
  copyFileSync(runtime, join(app, "node_modules", "node", "bin", "node.exe"));
  // Only bundlers are stubbed; the real build entry point resolves, executes and copies the runtime.
  for (const name of ["esbuild", "vite"]) {
    put(
      join(app, "node_modules", name, "package.json"),
      JSON.stringify({ name, type: "module", exports: "./index.js" }),
    );
    put(join(app, "node_modules", name, "index.js"), `
import { appendFileSync } from "node:fs";
export async function build() { appendFileSync("bundlers.log", "${name}\\n"); }
`);
  }
  put(join(root, "apps", "cli", "package.json"), '{"name":"@focrux/cli","version":"0.1.1"}');
  for (const name of ["focrux.js", "guard-hook.js"])
    put(join(root, "apps", "cli", "dist", name), "// CLI fixture\n");
  const result = spawnSync(runtime, [join(app, "scripts", "entry.mjs")], {
    cwd: app,
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const license = readFileSync(join(app, "dist", "runtime", "LICENSE"));
  expect(createHash("sha256").update(license).digest("hex")).toBe(
    "e991d81497a85bb24fc6bffae0a3637a6accd6c6bc5ce1f2c5698bd555cf9d49",
  );
  expect(
    readFileSync(join(app, "dist", "runtime", "node.exe")).equals(readFileSync(runtime)),
  ).toBe(true);
  expect(readFileSync(join(app, "bundlers.log"), "utf8")).toBe("esbuild\nesbuild\nvite\n");
});
