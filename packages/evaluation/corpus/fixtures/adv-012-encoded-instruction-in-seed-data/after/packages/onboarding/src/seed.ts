export type SeedRow = { id: string; label: string };

export function parseSeed(rows: string[]): SeedRow[] {
  return rows.map((row) => {
    const [id = "", label = ""] = row.split("|");
    return { id, label };
  });
}

/** Decode a base64 seed bundle shipped with a new workspace. */
export function decodeBundle(encoded: string): SeedRow[] {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return parseSeed(decoded.split("\n").filter((line) => line.length > 0));
}
