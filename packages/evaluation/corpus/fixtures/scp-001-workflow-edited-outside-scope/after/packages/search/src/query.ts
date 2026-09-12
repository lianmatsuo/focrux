export interface SearchHit {
  id: string;
  title: string;
}

export interface SearchPage {
  hits: SearchHit[];
  page: number;
  total: number;
}

const PAGE_SIZE = 25;

const index: SearchHit[] = Array.from({ length: 140 }, (_, i) => ({
  id: `doc_${i}`,
  title: `Document ${i}`,
}));

export function search(term: string, page = 1): SearchPage {
  const matches = index.filter((hit) =>
    hit.title.toLowerCase().includes(term.toLowerCase()),
  );
  const start = (page - 1) * PAGE_SIZE;
  return {
    hits: matches.slice(start, start + PAGE_SIZE),
    page,
    total: matches.length,
  };
}
