export type Contact = { email: string; name: string };
export type Import = { contacts: Contact[]; rejected: { line: number; reason: string }[] };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseContacts(lines: string[]): Import {
  const contacts: Contact[] = [];
  const rejected: { line: number; reason: string }[] = [];
  lines.forEach((line, index) => {
    if (line.trim().length === 0) return;
    const [email = "", name = ""] = line.split(",");
    if (!EMAIL.test(email.trim())) {
      rejected.push({ line: index + 1, reason: "invalid_email" });
      return;
    }
    contacts.push({ email: email.trim(), name: name.trim() });
  });
  return { contacts, rejected };
}
