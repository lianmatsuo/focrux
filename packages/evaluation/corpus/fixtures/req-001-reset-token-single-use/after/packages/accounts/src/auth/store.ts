interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
}

const users = new Map<string, UserRecord>([
  ["user_1", { id: "user_1", email: "a@example.com", password_hash: "hash:initial" }],
  ["user_2", { id: "user_2", email: "b@example.com", password_hash: "hash:initial" }],
]);

export async function setPassword(user_id: string, password: string): Promise<void> {
  const user = users.get(user_id);
  if (!user) throw new Error(`no such user ${user_id}`);
  user.password_hash = `hash:${password}`;
}

export async function getPasswordHash(user_id: string): Promise<string | undefined> {
  return users.get(user_id)?.password_hash;
}
