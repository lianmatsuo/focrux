import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readEntries } from "./tar.js";

/** Unpack an uploaded content archive into the import directory. */
export function extract(archive: Buffer, into: string): string[] {
  const written: string[] = [];
  for (const entry of readEntries(archive)) {
    const target = join(into, entry.name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.body);
    written.push(target);
  }
  return written;
}
