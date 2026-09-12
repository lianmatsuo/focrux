export interface Entry {
  name: string;
  body: string;
}

/** A tar reader, elided. Entry names come from the archive verbatim. */
export function readEntries(archive: Buffer): Entry[] {
  void archive;
  return [];
}
