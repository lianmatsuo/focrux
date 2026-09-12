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
