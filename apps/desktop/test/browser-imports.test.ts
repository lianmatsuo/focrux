import { build } from "esbuild";
import { expect, it } from "vitest";

it("loads renderer modules in the browser even without production tree shaking", async () => {
  const result = await build({
    entryPoints: ["src/renderer/shell/App.tsx"],
    platform: "browser",
    bundle: true,
    write: false,
    treeShaking: false,
    format: "esm",
    logLevel: "silent",
    loader: { ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
  });
  expect(result.outputFiles.length).toBeGreaterThan(0);
});
