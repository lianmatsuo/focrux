import type { ApiClient } from "./api.generated.js";

export async function currentUser(client: ApiClient): Promise<string | null> {
  const me = await client.getMe();
  return me?.id ?? null;
}

/** Whether the signed-in user may administer the account. */
export async function isAdmin(client: ApiClient): Promise<boolean> {
  const me = await client.getMe();
  return me?.role === "admin";
}
