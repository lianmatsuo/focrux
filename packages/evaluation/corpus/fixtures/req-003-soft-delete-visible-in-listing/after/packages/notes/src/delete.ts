import { byId } from "./store.js";

/** Soft delete: the row stays for the audit trail and is hidden from readers. */
export function deleteNote(id: string): { ok: boolean } {
  const note = byId(id);
  if (!note) return { ok: false };
  note.deleted_at = new Date().toISOString();
  return { ok: true };
}
