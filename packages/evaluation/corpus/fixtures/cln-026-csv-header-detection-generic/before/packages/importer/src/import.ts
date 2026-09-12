export interface ImportedRow {
  email: string;
}

/** First cut: assumes column 0 is the email and every file has a header. */
export function importCsv(text: string): ImportedRow[] {
  const [, ...rows] = text.trim().split(/\r?\n/);
  return rows.map((row) => ({ email: row.split(",")[0] ?? "" }));
}
