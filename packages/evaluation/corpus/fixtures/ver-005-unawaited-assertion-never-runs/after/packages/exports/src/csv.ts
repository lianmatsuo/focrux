export type Row = Record<string, string>;

/** RFC 4180: a field containing a comma, quote or newline is quoted and its quotes doubled. */
function escape(value: string): string {
  if (!/[",
]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export async function toCsv(rows: AsyncIterable<Row>, columns: string[]): Promise<string> {
  const lines = [columns.join(",")];
  for await (const row of rows) {
    lines.push(columns.map((c) => escape(row[c] ?? "")).join(","));
  }
  return lines.join("
");
}
