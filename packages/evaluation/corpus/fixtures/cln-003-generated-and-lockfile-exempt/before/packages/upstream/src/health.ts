import type { Client } from "./api.generated.js";

export async function health(client: Client): Promise<boolean> {
  return (await client.ping()) === "pong";
}
