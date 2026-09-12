export type Endpoint = { id: string; url: string };

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Check a customer-supplied endpoint before we make requests to it. */
export function isDeliverable(url: string): boolean {
  if (!isHttps(url)) return false;
  const host = new URL(url).hostname;
  return !BLOCKED_HOSTS.has(host);
}
