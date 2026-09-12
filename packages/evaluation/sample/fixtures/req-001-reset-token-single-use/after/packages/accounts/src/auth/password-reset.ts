import { findResetToken } from "./tokens.js";
import { setPassword } from "./store.js";

export type ResetOutcome = { ok: true } | { ok: false; reason: string };

/** Complete a password reset started by `issueResetToken`. */
export async function resetPassword(token: string, newPassword: string): Promise<ResetOutcome> {
  const record = findResetToken(token);
  if (!record) return { ok: false, reason: "unknown_token" };
  if (record.expires_at <= Date.now()) return { ok: false, reason: "expired_token" };

  await setPassword(record.user_id, newPassword);
  return { ok: true };
}
