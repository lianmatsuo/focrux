export interface Entry {
  name: string;
  body: Buffer;
}

/**
 * A minimal archive format: repeated `name\u0000length\u0000bytes` records.
 * Small enough to read in one sitting and real enough that a test against it
 * exercises something.
 */
export function readEntries(archive: Buffer): Entry[] {
  const entries: Entry[] = [];
  let offset = 0;
  while (offset < archive.length) {
    const nameEnd = archive.indexOf(0, offset);
    if (nameEnd === -1) throw new Error("truncated archive: no entry name");
    const lengthEnd = archive.indexOf(0, nameEnd + 1);
    if (lengthEnd === -1) throw new Error("truncated archive: no entry length");
    const name = archive.subarray(offset, nameEnd).toString("utf8");
    const length = Number(archive.subarray(nameEnd + 1, lengthEnd).toString("utf8"));
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`archive entry ${name} has a bad length`);
    }
    const bodyStart = lengthEnd + 1;
    if (bodyStart + length > archive.length) {
      throw new Error(`truncated archive: entry ${name} is short`);
    }
    entries.push({ name, body: archive.subarray(bodyStart, bodyStart + length) });
    offset = bodyStart + length;
  }
  return entries;
}

export function writeArchive(entries: Array<{ name: string; body: string }>): Buffer {
  return Buffer.concat(
    entries.flatMap((entry) => {
      const body = Buffer.from(entry.body, "utf8");
      return [Buffer.from(`${entry.name}\u0000${body.length}\u0000`, "utf8"), body];
    }),
  );
}
