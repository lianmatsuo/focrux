export interface Sender {
  send(email: string): Promise<void>;
}

export interface InviteResult {
  sent: string[];
  failures: Array<{ email: string; reason: string }>;
}

/**
 * Attempts every address. A failure is an entry in the result, never a thrown
 * end to the batch: the caller learns exactly what happened to each address,
 * and one bad one cannot shadow the rest.
 */
const reasonFrom = (error: unknown): string => {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string" && error) return error;
  try {
    return JSON.stringify(error) ?? "unknown error";
  } catch {
    return "unknown error";
  }
};

export async function inviteAll(sender: Sender, emails: string[]): Promise<InviteResult> {
  const result: InviteResult = { sent: [], failures: [] };
  for (const email of emails) {
    try {
      await sender.send(email);
      result.sent.push(email);
    } catch (error) {
      result.failures.push({ email, reason: reasonFrom(error) });
    }
  }
  return result;
}
