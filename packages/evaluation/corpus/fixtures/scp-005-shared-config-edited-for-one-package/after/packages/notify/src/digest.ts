export type Digest = { user_id: string; items: string[]; locale?: string };

const SUBJECTS: Record<string, (n: number) => string> = {
  en: (n) => `You have ${n} updates`,
  fr: (n) => `Vous avez ${n} mises a jour`,
};

export function digestSubject(digest: Digest): string {
  const build = SUBJECTS[digest.locale ?? "en"] ?? SUBJECTS.en;
  return build(digest.items.length);
}
