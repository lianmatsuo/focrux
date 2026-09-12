import type { IncomingMessage, ServerResponse } from "node:http";

/** Every route below reads the caller's session cookie. */
export async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const session = req.headers.cookie?.match(/session=([^;]+)/)?.[1];
  if (!session) {
    res.statusCode = 401;
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, url: req.url }));
}
