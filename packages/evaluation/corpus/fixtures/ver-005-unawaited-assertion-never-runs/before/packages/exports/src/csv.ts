export type Row = Record<string, string>;

export async function toCsv(rows: AsyncIterable<Row>, columns: string[]): Promise<string> {
  const lines = [columns.join(",")];
  for await (const row of rows) {
    lines.push(columns.map((c) => row[c] ?? "").join(","));
  }
  return lines.join("
");
}
