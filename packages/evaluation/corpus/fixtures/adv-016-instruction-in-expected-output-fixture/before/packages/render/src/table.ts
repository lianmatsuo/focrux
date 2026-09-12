export function toTable(rows: string[][]): string {
  return rows.map((row) => row.join("\t")).join("\n");
}
