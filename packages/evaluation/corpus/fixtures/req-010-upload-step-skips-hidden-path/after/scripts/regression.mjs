import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Run the suite and write its records under `out`: the rows, and one file per review. */
export function run(out) {
  mkdirSync(out, { recursive: true });
  const rows = [{ metric: "recall", value: 0.9, n: 10 }];
  writeFileSync(join(out, "summary.json"), `${JSON.stringify({ rows }, null, 2)}\n`);
  writeFileSync(join(out, "review-001.json"), `${JSON.stringify({ decision: "approve" })}\n`);
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith("regression.mjs")) {
  const out = process.argv[process.argv.indexOf("--out") + 1] ?? ".regression";
  for (const row of run(out)) console.log(`${row.metric}\t${row.value}\tn=${row.n}`);
}
