export interface ImportResult {
  imported: string[];
  rejected: Array<{ row: number; reason: string }>;
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A header cell names an email column when, split into words, it contains
 * "email" or "mail" as a word. Splitting covers separators and camelCase, so
 * "E-Mail", "e mail address", "CONTACT_EMAIL", "EmailAddress" and "MailAddress"
 * all reduce to the same test — normalisation, not enumeration — while
 * "mailing_list" does not, because "mailing" is a different word.
 */
export function namesEmailColumn(cell: string): boolean {
  const words = cell
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ");
  return words.some((word) => word === "email" || word === "mail");
}

/** RFC 4180 fields: quoted cells may hold commas, and "" inside quotes is a literal quote. */
const splitRow = (row: string): string[] => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
};

interface NumberedRow {
  cells: string[];
  /** 1-based line number in the original file, blank lines included. */
  line: number;
}

/**
 * A row is a header when no cell in it is email-shaped and at least one names
 * an email column. Headerless files are detected by scanning every row for an
 * email-shaped column, not just the first — one malformed leading row must not
 * reject the whole file.
 */
function findEmailColumn(rows: NumberedRow[]): { column: number; hasHeader: boolean } | null {
  const first = rows[0];
  if (!first) return null;
  const named = first.cells.findIndex(namesEmailColumn);
  if (named !== -1 && !first.cells.some((cell) => EMAIL_SHAPE.test(cell))) {
    return { column: named, hasHeader: true };
  }
  for (const row of rows) {
    const shaped = row.cells.findIndex((cell) => EMAIL_SHAPE.test(cell));
    if (shaped !== -1) return { column: shaped, hasHeader: false };
  }
  return null;
}

export function importCsv(text: string): ImportResult {
  const rows: NumberedRow[] = text
    .split(/\r?\n/)
    .map((row, index) => ({ cells: splitRow(row), line: index + 1, blank: row.trim().length === 0 }))
    .filter((row) => !row.blank)
    .map(({ cells, line }) => ({ cells, line }));
  const found = findEmailColumn(rows);
  if (!found) return { imported: [], rejected: [{ row: 1, reason: "no email column found" }] };

  const dataRows = found.hasHeader ? rows.slice(1) : rows;
  const result: ImportResult = { imported: [], rejected: [] };
  for (const { cells, line } of dataRows) {
    const email = cells[found.column] ?? "";
    if (EMAIL_SHAPE.test(email)) result.imported.push(email.toLowerCase());
    else result.rejected.push({ row: line, reason: `not an email address: "${email}"` });
  }
  return result;
}
