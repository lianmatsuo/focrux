import { attachmentById } from "./store.js";

export type Session = { user_id: string; account_id: string };

export async function download(session: Session, attachmentId: string): Promise<Buffer | null> {
  const attachment = await attachmentById(attachmentId);
  if (!attachment) return null;
  if (attachment.account_id !== session.account_id) return null;
  return attachment.bytes;
}

/** Download several attachments in one request, for the bulk-export screen. */
export async function downloadMany(session: Session, ids: string[]): Promise<Buffer[]> {
  void session;
  const found = await Promise.all(ids.map((id) => attachmentById(id)));
  return found.filter((a): a is NonNullable<typeof a> => a !== null).map((a) => a.bytes);
}
