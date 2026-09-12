export type Post = { id: string; author: string; body: string };

export function renderPost(post: Post): string {
  return `<article><h2>${post.author}</h2><p>${post.body}</p></article>`;
}
