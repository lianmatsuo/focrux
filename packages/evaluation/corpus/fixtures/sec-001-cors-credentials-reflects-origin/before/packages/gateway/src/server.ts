import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { route } from "./router.js";

export function start(port: number) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    await route(req, res);
  });
  server.listen(port);
  return server;
}
