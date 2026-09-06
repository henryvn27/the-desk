import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import {
  parseBrowserBridgeMessage,
  type BrowserBridgeMessage,
} from "./browser-bridge";

const MAX_BODY_BYTES = 120_000;
const LOOPBACK_HOST = "127.0.0.1";
const BRIDGE_PATH = "/v1/browser/context";

export type BrowserBridgeHost = {
  endpoint: string;
  port: number;
  token: string;
  close(): Promise<void>;
};

export type BrowserBridgeHostOptions = {
  port?: number;
  token?: string;
};

/**
 * Start the trusted desktop side of the browser bridge.
 *
 * The server is loopback-only and accepts only a short-lived bearer token and
 * the versioned, schema-bounded page-context envelope. It never accepts a
 * command, credential, arbitrary URL scheme, or page-execution request.
 */
export async function startBrowserBridgeHost(
  onContext: (message: BrowserBridgeMessage) => void,
  options: BrowserBridgeHostOptions = {},
): Promise<BrowserBridgeHost> {
  const token = options.token ?? randomBytes(24).toString("base64url");
  if (!token.trim()) throw Error("Browser bridge token cannot be empty.");
  const server = createServer((request, response) => {
    void handleRequest(request, response, token, onContext);
  });
  await listen(server, options.port ?? 0);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw Error("The browser bridge did not receive a loopback port.");
  }
  return {
    endpoint: `http://${LOOPBACK_HOST}:${address.port}${BRIDGE_PATH}`,
    port: address.port,
    token,
    close: () => closeServer(server),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  onContext: (message: BrowserBridgeMessage) => void,
) {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
  if (origin && !origin.startsWith("chrome-extension://")) {
    respond(response, 403, { error: "Browser bridge origin is not allowed." });
    return;
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") {
    if (request.url !== BRIDGE_PATH) {
      respond(response, 404, { error: "Browser bridge route not found." });
      return;
    }
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    respond(response, 204);
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    respond(response, 200, { ok: true, version: 1 });
    return;
  }
  if (request.method !== "POST" || request.url !== BRIDGE_PATH) {
    respond(response, 404, { error: "Browser bridge route not found." });
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    respond(response, 401, { error: "Browser bridge authorization failed." });
    return;
  }
  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    respond(response, error instanceof BodyTooLargeError ? 413 : 400, {
      error:
        error instanceof BodyTooLargeError
          ? "Browser context is too large."
          : "Browser context request is invalid.",
    });
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    respond(response, 400, { error: "Browser context must be JSON." });
    return;
  }
  try {
    const message = parseBrowserBridgeMessage(value);
    onContext(message);
    respond(response, 202, { accepted: true, requestId: message.requestId });
  } catch {
    respond(response, 400, { error: "Browser context failed validation." });
  }
}

class BodyTooLargeError extends Error {}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total > MAX_BODY_BYTES) {
        request.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body?: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function listen(server: ReturnType<typeof createServer>, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
