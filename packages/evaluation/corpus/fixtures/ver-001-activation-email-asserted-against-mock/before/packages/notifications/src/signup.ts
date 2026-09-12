import { createUser } from "./users.js";

export async function signup(email: string, password: string): Promise<{ id: string }> {
  const user = await createUser(email, password);
  return { id: user.id };
}
