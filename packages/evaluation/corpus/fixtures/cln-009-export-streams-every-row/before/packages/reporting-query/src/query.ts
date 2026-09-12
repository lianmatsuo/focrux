const PAGE_SIZE = 50;

export interface Row {
  id: string;
  amount: number;
}

const rows: Row[] = [
  ...Array.from({ length: 319 }, (_, i) => ({ id: `row_${i}`, amount: i })),
  // Report ids come from user-supplied document titles, so they contain
  // whatever a person typed.
  { id: 'row_320,"odd"\nname', amount: 320 },
];

/** Paginated read used by the table view. */
export function findRows(page = 1): Row[] {
  const start = (page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}

export function countRows(): number {
  return rows.length;
}
