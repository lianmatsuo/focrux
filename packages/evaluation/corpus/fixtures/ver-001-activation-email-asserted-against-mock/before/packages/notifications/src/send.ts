import { smtpTransport, type Message } from "./transport.js";

const transport = smtpTransport(process.env.SMTP_HOST ?? "");

/**
 * Best-effort send. Delivery failures are logged and swallowed so that a
 * signup is never rolled back because the mail server was briefly away.
 */
export async function sendEmail(message: Message): Promise<void> {
  try {
    await transport.deliver(message);
  } catch (error) {
    console.warn("email delivery failed", { to: message.to, error });
  }
}
