import assert from "node:assert/strict";
import { request } from "node:http";
import test from "node:test";
import {
  startBrowserBridgeHost,
  type BrowserBridgeHost,
} from "./browser-bridge-host";

const message = {
  version: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  type: "page-context",
  context: {
    browser: "chrome",
    tabId: "tab-7",
    url: "https://classroom.google.com/c/physics",
    title: "Physics assignment",
    selectionText: "Read pages 12–15",
    visibleText: "Due Friday. Complete the force diagram.",
    capturedAt: "2026-09-06T19:00:00.000Z",
    adapter: "classroom",
  },
} as const;

test("browser bridge host accepts an authorized validated envelope", async () => {
  let received: unknown;
  const host = await startBrowserBridgeHost((value) => {
    received = value;
  }, { token: "test-token" });
  try {
    const response = await send(host, {
      method: "POST",
      path: "/v1/browser/context",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(received, message);
  } finally {
    await host.close();
  }
});

test("browser bridge host rejects missing authorization, invalid origins, and invalid data", async () => {
  const host = await startBrowserBridgeHost(() => undefined, {
    token: "test-token",
  });
  try {
    assert.equal(
      (await send(host, { method: "POST", path: "/v1/browser/context", body: "{}" })).status,
      401,
    );
    assert.equal(
      (
        await send(host, {
          method: "POST",
          path: "/v1/browser/context",
          headers: {
            authorization: "Bearer test-token",
            origin: "https://attacker.invalid",
          },
          body: JSON.stringify(message),
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await send(host, {
          method: "POST",
          path: "/v1/browser/context",
          headers: { authorization: "Bearer test-token" },
          body: JSON.stringify({ ...message, command: "execute" }),
        })
      ).status,
      400,
    );
  } finally {
    await host.close();
  }
});

test("browser bridge host exposes a bounded health route and preflight", async () => {
  const host = await startBrowserBridgeHost(() => undefined, {
    token: "test-token",
  });
  try {
    const health = await send(host, { method: "GET", path: "/health" });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true, version: 1 });
    const preflight = await send(host, {
      method: "OPTIONS",
      path: "/v1/browser/context",
      headers: { origin: "chrome-extension://desk-test" },
    });
    assert.equal(preflight.status, 204);
    assert.match(
      String(preflight.headers["access-control-allow-origin"] ?? ""),
      /chrome-extension/,
    );
  } finally {
    await host.close();
  }
});

function send(
  host: BrowserBridgeHost,
  input: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const requestHandle = request(
      `http://127.0.0.1:${host.port}${input.path}`,
      { method: input.method, headers: input.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    requestHandle.on("error", reject);
    if (input.body) requestHandle.write(input.body);
    requestHandle.end();
  });
}
