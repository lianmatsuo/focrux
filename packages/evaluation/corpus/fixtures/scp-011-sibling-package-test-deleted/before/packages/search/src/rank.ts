export interface Hit {
  id: string;
  score: number;
  updated_at: string;
}

export function rank(hits: Hit[]): Hit[] {
  return [...hits].sort((a, b) => b.score - a.score);
}
