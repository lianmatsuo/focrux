import { createUser } from "./users.js";
import { sendEmail } from "./send.js";

export async function signup(email: string, password: string): Promise<{ id: string }> {
  const user = await createUser(email, password);
  await sendEmail({
    to: email,
    subject: "Activate your account",
    body: `Welcome. Activate at https://app.example.com/activate/${user.activation_token}`,
  });
  return { id: user.id };
}
