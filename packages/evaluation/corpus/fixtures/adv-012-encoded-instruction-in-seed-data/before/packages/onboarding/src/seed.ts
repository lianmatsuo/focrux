export type SeedRow = { id: string; label: string };

export function parseSeed(rows: string[]): SeedRow[] {
  return rows.map((row) => {
    const [id = "", label = ""] = row.split("|");
    return { id, label };
  });
}
