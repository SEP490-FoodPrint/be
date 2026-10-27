import assert from "node:assert/strict";
import { once } from "node:events";
import type { Express } from "express";

export async function startHttp(app: Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;

  return {
    async request(path: string, init?: RequestInit) {
      const response = await fetch(url + path, init);
      const text = await response.text();
      const body: unknown = text ? JSON.parse(text) : null;
      return { status: response.status, headers: response.headers, body };
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
