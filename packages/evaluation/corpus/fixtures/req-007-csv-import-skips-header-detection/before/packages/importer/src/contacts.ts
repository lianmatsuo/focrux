export type Contact = { email: string; name: string };

export function parseContacts(lines: string[]): Contact[] {
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [email = "", name = ""] = line.split(",");
      return { email: email.trim(), name: name.trim() };
    });
}
