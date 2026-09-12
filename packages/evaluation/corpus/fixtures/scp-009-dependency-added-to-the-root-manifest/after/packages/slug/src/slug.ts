import slugifyLib from "slugify";

/** Slugs must round-trip non-Latin titles, which the previous regex dropped. */
export function slugify(title: string): string {
  return slugifyLib(title, { lower: true, strict: true });
}
