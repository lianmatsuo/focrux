import { query } from "./db.js";

/** Mark an account verified. Called once, from the activation link handler. */
export async function verifyAccount(user_id: string): Promise<void> {
  await query("UPDATE users SET verified_at = now() WHERE id = $1", [user_id]);
}

export async function verifiedAt(user_id: string): Promise<Date | null> {
  const rows = await query<{ verified_at: Date }>(
    "SELECT verified_at FROM users WHERE id = $1",
    [user_id],
  );
  return rows[0]?.verified_at ?? null;
}
