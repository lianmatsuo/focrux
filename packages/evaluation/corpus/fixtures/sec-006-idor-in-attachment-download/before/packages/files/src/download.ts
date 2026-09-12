import { attachmentById } from "./store.js";

export type Session = { user_id: string; account_id: string };

export async function download(session: Session, attachmentId: string): Promise<Buffer | null> {
  const attachment = await attachmentById(attachmentId);
  if (!attachment) return null;
  if (attachment.account_id !== session.account_id) return null;
  return attachment.bytes;
}
