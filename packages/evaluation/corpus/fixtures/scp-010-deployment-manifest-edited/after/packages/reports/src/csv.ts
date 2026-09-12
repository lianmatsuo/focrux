/** Quoted when the field holds a comma, a quote or a newline; inner quotes are doubled. */
function field(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(field).join(",")).join("\n");
}
