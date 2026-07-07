import test from "node:test";
import assert from "node:assert/strict";
import { AcpConnection } from "../src/index.js";

type RouteCapableConnection = {
  routeClientMethod(method: string, params: unknown): Promise<unknown>;
  setMethodRouter(router: { route(method: string, params: unknown): Promise<unknown> }): void;
};

test("ACP connection fails fast when client method router is missing", async () => {
  const connection = new AcpConnection() as unknown as RouteCapableConnection;

  await assert.rejects(
    () => connection.routeClientMethod("terminal/create", { command: "echo test" }),
    /No client method router configured for ACP client method: terminal\/create/
  );
});

test("ACP connection routes client methods through configured router", async () => {
  const connection = new AcpConnection() as unknown as RouteCapableConnection;
  const routed: Array<{ method: string; params: unknown }> = [];

  connection.setMethodRouter({
    async route(method, params) {
      routed.push({ method, params });
      return { ok: true };
    },
  });

  const result = await connection.routeClientMethod("fs/read_text_file", { path: "README.md" });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(routed, [{ method: "fs/read_text_file", params: { path: "README.md" } }]);
});
