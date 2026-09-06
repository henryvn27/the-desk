import assert from "node:assert/strict";
import test from "node:test";
import {
  BridgeTransportError,
  DEFAULT_ENDPOINT,
  parseBridgeSettings,
  sendBrowserContext,
  validateLoopbackEndpoint,
} from "../src/transport";
import { startBrowserBridgeHost } from "../../../packages/integrations/browser-bridge-host";

const message = {
  version: 1,
  requestId: "00000000-0000-4000-8000-000000000001",
  type: "page-context",
  context: {
    browser: "chrome",
    tabId: "7",
    url: "https://classroom.google.com/c/physics",
    title: "Physics assignment",
    selectionText: "Read pages 12–15",
    visibleText: "Due Friday.",
    capturedAt: "2026-09-06T19:00:00.000Z",
    adapter: "classroom",
  },
} as const;

test("endpoint validation keeps transport on the explicit loopback path", () => {
  assert.equal(validateLoopbackEndpoint(DEFAULT_ENDPOINT), DEFAULT_ENDPOINT);
  assert.equal(
    validateLoopbackEndpoint("https://localhost:43117/v1/browser/context"),
    "https://localhost:43117/v1/browser/context",
  );
  for (const endpoint of [
    "https://example.com/v1/browser/context",
    "http://127.0.0.1:43117/other",
    "http://127.0.0.1:43117/v1/browser/context?run=1",
    "http://user:pass@127.0.0.1:43117/v1/browser/context",
    "ftp://127.0.0.1:43117/v1/browser/context",
  ]) {
    assert.throws(
      () => validateLoopbackEndpoint(endpoint),
      (error: unknown) =>
        error instanceof BridgeTransportError && error.code === "INVALID_ENDPOINT",
    );
  }
});

test("settings reject header injection and keep the default endpoint bounded", () => {
  assert.deepEqual(parseBridgeSettings(undefined), {
    endpoint: DEFAULT_ENDPOINT,
    token: "",
  });
  assert.throws(() => parseBridgeSettings({ token: "bad\r\nvalue" }));
  assert.throws(() => parseBridgeSettings({ token: "x".repeat(257) }));
});

test("transport posts the exact bridge envelope and omits credentials", async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const receipt = await sendBrowserContext(
    message,
    { endpoint: DEFAULT_ENDPOINT, token: "install-token" },
    async (input, init) => {
      request = { input, init };
      return new Response(null, { status: 204 });
    },
  );

  assert.deepEqual(receipt, { requestId: message.requestId, status: 204 });
  assert.equal(request?.input.toString(), DEFAULT_ENDPOINT);
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.credentials, "omit");
  assert.equal(request?.init?.mode, "cors");
  assert.equal(
    (request?.init?.headers as Record<string, string>).Authorization,
    "Bearer install-token",
  );
  assert.deepEqual(JSON.parse(String(request?.init?.body)), message);
});

test("transport interoperates with the Desk loopback host", async () => {
  let received: unknown;
  const host = await startBrowserBridgeHost((value) => {
    received = value;
  }, { token: "interop-token" });
  try {
    const receipt = await sendBrowserContext(message, {
      endpoint: host.endpoint,
      token: host.token,
    });
    assert.deepEqual(receipt, { requestId: message.requestId, status: 202 });
    assert.deepEqual(received, message);
  } finally {
    await host.close();
  }
});

test("transport exposes bounded disconnect and host rejection states", async () => {
  await assert.rejects(
    () =>
      sendBrowserContext(
        message,
        { endpoint: DEFAULT_ENDPOINT, token: "install-token" },
        async () => {
          throw new TypeError("Failed to fetch");
        },
      ),
    (error: unknown) =>
      error instanceof BridgeTransportError && error.code === "DISCONNECTED",
  );
  await assert.rejects(
    () =>
      sendBrowserContext(
        message,
        { endpoint: DEFAULT_ENDPOINT, token: "install-token" },
        async () => new Response(null, { status: 401 }),
      ),
    (error: unknown) =>
      error instanceof BridgeTransportError && error.code === "AUTH_REQUIRED",
  );
});

test("transport rejects malformed envelopes before opening the host connection", async () => {
  let called = false;
  await assert.rejects(
    () =>
      sendBrowserContext(
        { ...message, type: "execute-page-script" },
        { endpoint: DEFAULT_ENDPOINT, token: "" },
        async () => {
          called = true;
          return new Response(null, { status: 204 });
        },
      ),
    (error: unknown) =>
      error instanceof BridgeTransportError && error.code === "INVALID_MESSAGE",
  );
  assert.equal(called, false);
});
