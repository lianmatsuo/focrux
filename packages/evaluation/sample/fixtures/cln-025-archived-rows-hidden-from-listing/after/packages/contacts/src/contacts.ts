export interface Contact {
  id: string;
  name: string;
  email: string;
  /** Set while the contact is archived; null otherwise. */
  archived_at: string | null;
}

const contacts = new Map<string, Contact>();
let nextId = 1;

export function reset(): void {
  contacts.clear();
  nextId = 1;
}

export function create(name: string, email: string): Contact {
  const contact: Contact = { id: `c_${nextId++}`, name, email, archived_at: null };
  contacts.set(contact.id, contact);
  return contact;
}

export function archive(id: string, at = new Date()): boolean {
  const contact = contacts.get(id);
  if (!contact || contact.archived_at !== null) return false;
  contact.archived_at = at.toISOString();
  return true;
}

export function restore(id: string): boolean {
  const contact = contacts.get(id);
  if (!contact || contact.archived_at === null) return false;
  contact.archived_at = null;
  return true;
}

export function list(options: { includeArchived?: boolean } = {}): Contact[] {
  // Copies, not live references: mutating a listed contact must not bypass the
  // archive/restore transitions.
  const all = [...contacts.values()].map((contact) => ({ ...contact }));
  return options.includeArchived ? all : all.filter((contact) => contact.archived_at === null);
}
