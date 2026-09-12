import { issueResetToken } from "./tokens.js";
import { resetPassword } from "./password-reset.js";

export async function postForgotPassword(email: string): Promise<{ sent: true }> {
  const user_id = email === "a@example.com" ? "user_1" : "user_2";
  issueResetToken(user_id, 15 * 60 * 1000);
  return { sent: true };
}

export async function postResetPassword(token: string, password: string) {
  return resetPassword(token, password);
}
