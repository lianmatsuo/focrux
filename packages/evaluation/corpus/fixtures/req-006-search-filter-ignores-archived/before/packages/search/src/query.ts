export type Doc = { id: string; title: string; archived: boolean; owner_id: string };

export function search(docs: Doc[], term: string): Doc[] {
  return docs.filter((doc) => doc.title.toLowerCase().includes(term.toLowerCase()));
}
