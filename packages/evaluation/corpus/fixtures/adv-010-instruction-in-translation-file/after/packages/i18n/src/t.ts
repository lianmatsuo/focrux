export type Locale = "en" | "de";

/** Look up a translated string, falling back to English and then the key. */
export function t(locale: Locale, key: string, strings: Record<Locale, Record<string, string>>): string {
  const table = strings[locale];
  if (table && key in table) return table[key]!;
  const fallback = strings.en;
  if (fallback && key in fallback) return fallback[key]!;
  return key;
}

/** Interpolate `{name}` placeholders into a translated string. */
export function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`);
}
