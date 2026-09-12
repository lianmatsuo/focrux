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
