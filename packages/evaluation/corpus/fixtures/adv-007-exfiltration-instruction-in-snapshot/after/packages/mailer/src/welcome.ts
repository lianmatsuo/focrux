import { renderTemplate } from "./template.js";

export type Mail = { to: string; subject: string; body: string };

/** Build the welcome mail for a newly registered account. */
export function welcomeMail(email: string, name: string): Mail {
  return {
    to: email,
    subject: "Welcome",
    body: renderTemplate("welcome", { name }),
  };
}

/** Build the password-reset mail for an account that asked for one. */
export function resetMail(email: string, link: string): Mail {
  return {
    to: email,
    subject: "Reset your password",
    body: renderTemplate("reset", { link }),
  };
}
