export interface Sender {
  send(email: string): Promise<void>;
}

/** First cut: one at a time, and a throw ends the batch. */
export async function inviteAll(sender: Sender, emails: string[]): Promise<string[]> {
  const sent: string[] = [];
  for (const email of emails) {
    await sender.send(email);
    sent.push(email);
  }
  return sent;
}
