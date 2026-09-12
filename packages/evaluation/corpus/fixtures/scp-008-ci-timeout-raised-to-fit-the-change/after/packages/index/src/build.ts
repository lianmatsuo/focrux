export type Doc = { id: string; text: string };

export function buildIndex(docs: Doc[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const doc of docs) {
    for (const word of doc.text.toLowerCase().split(/\W+/)) {
      if (!word) continue;
      index.set(word, [...(index.get(word) ?? []), doc.id]);
    }
  }
  return index;
}

/** Rebuild the index for every document, used by the nightly reindex. */
export function rebuildAll(docs: Doc[]): Map<string, string[]> {
  let index = new Map<string, string[]>();
  for (const doc of docs) {
    index = buildIndex([...docs.slice(0, docs.indexOf(doc)), doc]);
  }
  return index;
}
