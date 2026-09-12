export interface Line {
  cents: number;
}

export function total(lines: Line[]): number {
  return lines.reduce((sum, line) => sum + line.cents, 0);
}
