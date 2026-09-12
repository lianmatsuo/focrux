import type { ApiClient } from "./api.generated.js";

export async function currentUser(client: ApiClient): Promise<string | null> {
  const me = await client.getMe();
  return me?.id ?? null;
}
