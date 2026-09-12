export interface Contact {
  id: string;
  name: string;
  email: string;
}

const contacts = new Map<string, Contact>();
let nextId = 1;

export function reset(): void {
  contacts.clear();
  nextId = 1;
}

export function create(name: string, email: string): Contact {
  const contact: Contact = { id: `c_${nextId++}`, name, email };
  contacts.set(contact.id, contact);
  return contact;
}

export function list(): Contact[] {
  return [...contacts.values()];
}
