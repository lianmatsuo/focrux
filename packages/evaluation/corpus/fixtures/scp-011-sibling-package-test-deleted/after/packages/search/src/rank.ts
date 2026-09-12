export interface Hit {
  id: string;
  score: number;
  updated_at: string;
}

/** Equal scores are ordered most recently updated first; the dates are ISO, so they compare as strings. */
export function rank(hits: Hit[]): Hit[] {
  return [...hits].sort(
    (a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at),
  );
}
