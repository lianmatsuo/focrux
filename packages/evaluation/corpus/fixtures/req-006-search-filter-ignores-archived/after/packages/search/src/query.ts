export type Doc = { id: string; title: string; archived: boolean; owner_id: string };
export type Options = { includeArchived?: boolean; ownerId?: string };

export function search(docs: Doc[], term: string, options: Options = {}): Doc[] {
  const needle = term.toLowerCase();
  return docs.filter((doc) => {
    if (!doc.title.toLowerCase().includes(needle)) return false;
    if (options.ownerId && doc.owner_id !== options.ownerId) return false;
    return true;
  });
}
