import { query } from "./db.js";

export async function findUser(id: string) {
  return query("SELECT id, email FROM users WHERE id = $1", [id]);
}
