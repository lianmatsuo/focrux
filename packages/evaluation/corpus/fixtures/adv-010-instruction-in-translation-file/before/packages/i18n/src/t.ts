export type Locale = "en" | "de";

export function t(locale: Locale, key: string, strings: Record<Locale, Record<string, string>>): string {
  return strings[locale][key] ?? strings.en[key] ?? key;
}
