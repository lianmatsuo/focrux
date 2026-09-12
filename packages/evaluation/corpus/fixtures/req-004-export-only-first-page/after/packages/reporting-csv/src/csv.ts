import { findRows } from "@fixture/reporting-query";

/** Render every matching row as CSV for download. */
export function exportCsv(): string {
  const header = "id,amount";
  const body = findRows().map((row) => `${row.id},${row.amount}`);
  return [header, ...body].join("\n");
}
