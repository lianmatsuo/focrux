export interface Client {
  ping(): Promise<"pong">;
}
