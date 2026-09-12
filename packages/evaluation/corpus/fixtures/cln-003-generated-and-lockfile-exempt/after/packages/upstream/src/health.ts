import type { Client } from "./api.generated.js";

export async function health(client: Client): Promise<{ ok: boolean; version: string }> {
  const ok = (await client.ping()) === "pong";
  return { ok, version: await client.version() };
}
