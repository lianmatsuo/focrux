export interface Client {
  ping(): Promise<"pong">;
  version(): Promise<string>;
}
