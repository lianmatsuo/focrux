import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { readEntries } from "./tar.js";

export class UnsafeEntryError extends Error {}

/** Unpack an uploaded content archive into the import directory. */
export function extract(archive: Buffer, into: string): string[] {
  const root = resolve(into);
  const written: string[] = [];
  for (const entry of readEntries(archive)) {
    const target = resolve(root, entry.name);
    // resolve() collapses any ".." the entry name carried, so the containment
    // test is on the resolved path rather than on the name.
    if (target !== root && !target.startsWith(root + sep)) {
      throw new UnsafeEntryError(`archive entry ${entry.name} resolves outside ${root}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    // Bodies are written as bytes: a content archive carries images and PDFs
    // as well as text, and a utf8 round trip corrupts them.
    writeFileSync(target, entry.body);
    written.push(target);
  }
  return written;
}
