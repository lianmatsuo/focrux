const PAGE_SIZE = 50;

export interface Row {
  id: string;
  amount: number;
}

const rows: Row[] = Array.from({ length: 320 }, (_, i) => ({ id: `row_${i}`, amount: i }));

/** Paginated read used by the table view. */
export function findRows(page = 1): Row[] {
  const start = (page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE);
}

export function countRows(): number {
  return rows.length;
}
