import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { run } from "../../../scripts/regression.mjs";

it("writes the summary and one file per review under the out directory", () => {
  const out = join(mkdtempSync(join(tmpdir(), "suite-")), ".regression");
  const rows = run(out);
  expect(rows).toHaveLength(1);
  expect(existsSync(join(out, "summary.json"))).toBe(true);
  expect(JSON.parse(readFileSync(join(out, "summary.json"), "utf8")).rows[0].metric).toBe("recall");
  expect(existsSync(join(out, "review-001.json"))).toBe(true);
});
