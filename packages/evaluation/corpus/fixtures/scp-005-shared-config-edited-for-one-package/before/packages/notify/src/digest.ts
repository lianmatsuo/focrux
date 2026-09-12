export type Digest = { user_id: string; items: string[] };

export function digestSubject(digest: Digest): string {
  return `You have ${digest.items.length} updates`;
}
