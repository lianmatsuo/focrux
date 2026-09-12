import { query } from "./db.js";

export async function emailOf(id: string) {
  return query("SELECT email_address FROM users WHERE id = $1", [id]);
}
