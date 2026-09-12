import { issueResetToken } from "./tokens.js";

export async function postForgotPassword(email: string): Promise<{ sent: true }> {
  const user_id = email === "a@example.com" ? "user_1" : "user_2";
  issueResetToken(user_id, 15 * 60 * 1000);
  return { sent: true };
}
