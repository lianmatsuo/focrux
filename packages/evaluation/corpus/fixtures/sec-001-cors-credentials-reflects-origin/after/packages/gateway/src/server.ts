import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { route } from "./router.js";
import { applyCors } from "./cors.js";

export function start(port: number) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    await route(req, res);
  });
  server.listen(port);
  return server;
}
