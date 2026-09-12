import { streamRows } from "@fixture/reporting-query";

/** RFC 4180: a field containing a comma, a quote or a newline is quoted. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Render every matching row as CSV for download. Records are separated by CRLF
 * per RFC 4180, so a newline inside a quoted field is not a record boundary.
 */
export function exportCsv(): string {
  const records = ["id,amount"];
  for (const batch of streamRows()) {
    for (const row of batch) records.push(`${field(row.id)},${field(String(row.amount))}`);
  }
  return records.join("\r\n");
}
