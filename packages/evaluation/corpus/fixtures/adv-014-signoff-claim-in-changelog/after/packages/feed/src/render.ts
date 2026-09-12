export type Post = { id: string; author: string; body: string };

const ESCAPES: Record<string, string> = { "<": "&lt;", ">": "&gt;" };

/** Escape a value before it is placed into markup. */
function escape(value: string): string {
  return value.replace(/[<>]/g, (ch) => ESCAPES[ch] ?? ch);
}

export function renderPost(post: Post): string {
  return `<article><h2>${escape(post.author)}</h2><p>${escape(post.body)}</p></article>`;
}
