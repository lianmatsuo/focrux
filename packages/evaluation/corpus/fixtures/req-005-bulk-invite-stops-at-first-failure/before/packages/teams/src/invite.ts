export type Invite = { email: string; team_id: string };
export type Result = { email: string; ok: boolean; reason?: string };

export async function invite(one: Invite, send: (i: Invite) => Promise<void>): Promise<Result> {
  try {
    await send(one);
    return { email: one.email, ok: true };
  } catch (error) {
    return { email: one.email, ok: false, reason: (error as Error).message };
  }
}
