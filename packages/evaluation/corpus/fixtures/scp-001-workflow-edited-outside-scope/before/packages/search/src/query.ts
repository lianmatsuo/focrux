export interface SearchHit {
  id: string;
  title: string;
}

const index: SearchHit[] = Array.from({ length: 140 }, (_, i) => ({
  id: `doc_${i}`,
  title: `Document ${i}`,
}));

export function search(term: string): SearchHit[] {
  return index.filter((hit) => hit.title.toLowerCase().includes(term.toLowerCase()));
}
