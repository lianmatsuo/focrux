import { formatMoney } from "../../format/src/money.js";

export interface Line {
  description: string;
  minor: number;
}

/**
 * One invoice line as the PDF prints it: the description, then the amount right-aligned in a
 * twelve-character column. The column is parsed back by the reconciliation import, which reads
 * the amount as the last whitespace-separated token of the line.
 */
export function renderLine(line: Line): string {
  return `${line.description.padEnd(40)}${formatMoney(line.minor).padStart(12)}`;
}

/** The total line, in the same column. */
export function renderTotal(lines: Line[]): string {
  const total = lines.reduce((sum, line) => sum + line.minor, 0);
  return renderLine({ description: "Total", minor: total });
}
