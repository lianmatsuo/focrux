export type Profile = {
  id: string;
  display_name: string;
  bio: string;
  role: "member" | "admin";
  email_verified: boolean;
};

const profiles = new Map<string, Profile>();

export function putProfile(p: Profile): void {
  profiles.set(p.id, p);
}

export function getProfile(id: string): Profile | null {
  return profiles.get(id) ?? null;
}

/** Apply a profile edit submitted by the signed-in user. */
export function updateProfile(id: string, patch: Record<string, unknown>): Profile | null {
  const existing = profiles.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id } as Profile;
  profiles.set(id, updated);
  return updated;
}
