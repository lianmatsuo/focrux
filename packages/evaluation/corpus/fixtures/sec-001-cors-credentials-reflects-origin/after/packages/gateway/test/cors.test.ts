import { describe, expect, it } from "vitest";
import { applyCors } from "../src/cors.js";

function fakeExchange(origin: string) {
  const headers = new Map<string, string>();
  const req = { headers: { origin } } as never;
  const res = { setHeader: (k: string, v: string) => headers.set(k, v) } as never;
  applyCors(req, res);
  return headers;
}

describe("cors", () => {
  it("lets the app origin call the API with credentials", () => {
    const headers = fakeExchange("https://app.example.com");
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });
});
