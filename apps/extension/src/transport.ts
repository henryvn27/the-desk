import {
  browserBridgeMessage,
  type BrowserBridgeMessage,
} from "../../../packages/integrations/browser-bridge";
import type { ChromeStorageArea } from "./chrome-api";

export const DEFAULT_ENDPOINT =
  "http://127.0.0.1:43117/v1/browser/context";
export const STORAGE_KEY = "deskBridgeSettings";
export const REQUEST_TIMEOUT_MS = 2_500;

export type BridgeErrorCode =
  | "INVALID_ENDPOINT"
  | "INVALID_SETTINGS"
  | "INVALID_MESSAGE"
  | "DISCONNECTED"
  | "AUTH_REQUIRED"
  | "PAYLOAD_TOO_LARGE"
  | "HOST_REJECTED";

export class BridgeTransportError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeTransportError";
    this.code = code;
  }
}

export interface BridgeSettings {
  endpoint: string;
  token: string;
}

export interface BridgeReceipt {
  requestId: string;
  status: number;
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "localhost";
}

export function validateLoopbackEndpoint(endpoint: string): string {
  if (typeof endpoint !== "string" || !endpoint.trim()) {
    throw new BridgeTransportError(
      "INVALID_ENDPOINT",
      "Enter the local Desk bridge endpoint.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    throw new BridgeTransportError(
      "INVALID_ENDPOINT",
      "The Desk bridge endpoint is not a valid URL.",
    );
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !isLoopbackHost(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/v1/browser/context"
  ) {
    throw new BridgeTransportError(
      "INVALID_ENDPOINT",
      "Use the loopback Desk bridge URL ending in /v1/browser/context.",
    );
  }

  return parsed.toString();
}

export function parseBridgeSettings(value: unknown): BridgeSettings {
  if (value === undefined || value === null) {
    return { endpoint: DEFAULT_ENDPOINT, token: "" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeTransportError(
      "INVALID_SETTINGS",
      "The saved Desk bridge settings are invalid.",
    );
  }

  const record = value as Record<string, unknown>;
  const endpoint =
    record.endpoint === undefined || record.endpoint === ""
      ? DEFAULT_ENDPOINT
      : record.endpoint;
  if (typeof endpoint !== "string") {
    throw new BridgeTransportError(
      "INVALID_SETTINGS",
      "The Desk bridge endpoint must be text.",
    );
  }

  const token = record.token === undefined ? "" : record.token;
  if (typeof token !== "string" || token.length > 256 || /[\r\n]/.test(token)) {
    throw new BridgeTransportError(
      "INVALID_SETTINGS",
      "The Desk bridge token is invalid.",
    );
  }

  return { endpoint: validateLoopbackEndpoint(endpoint), token };
}

export async function loadBridgeSettings(
  storage: ChromeStorageArea,
): Promise<BridgeSettings> {
  const stored = await storage.get(STORAGE_KEY);
  return parseBridgeSettings(stored[STORAGE_KEY]);
}

export async function saveBridgeSettings(
  storage: ChromeStorageArea,
  value: unknown,
): Promise<BridgeSettings> {
  const settings = parseBridgeSettings(value);
  await storage.set({ [STORAGE_KEY]: settings });
  return settings;
}

function transportErrorForStatus(status: number): BridgeTransportError {
  if (status === 401 || status === 403) {
    return new BridgeTransportError(
      "AUTH_REQUIRED",
      "The Desk host rejected the bridge token.",
    );
  }
  if (status === 413) {
    return new BridgeTransportError(
      "PAYLOAD_TOO_LARGE",
      "The Desk host rejected this capture because it is too large.",
    );
  }
  if (status === 400 || status === 422) {
    return new BridgeTransportError(
      "INVALID_MESSAGE",
      "The Desk host rejected the capture shape.",
    );
  }
  return new BridgeTransportError(
    "HOST_REJECTED",
    "The Desk host rejected this capture.",
  );
}

export async function sendBrowserContext(
  value: unknown,
  settings: BridgeSettings,
  fetchImpl: FetchImplementation = fetch,
): Promise<BridgeReceipt> {
  let message: BrowserBridgeMessage;
  try {
    message = browserBridgeMessage.parse(value);
  } catch {
    throw new BridgeTransportError(
      "INVALID_MESSAGE",
      "The browser capture did not match the Desk bridge contract.",
    );
  }

  const endpoint = validateLoopbackEndpoint(settings.endpoint);
  if (typeof settings.token !== "string" || /[\r\n]/.test(settings.token)) {
    throw new BridgeTransportError(
      "INVALID_SETTINGS",
      "The Desk bridge token is invalid.",
    );
  }
  if (!settings.token) {
    throw new BridgeTransportError(
      "AUTH_REQUIRED",
      "Enter the per-install bridge token before sending.",
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      credentials: "omit",
      mode: "cors",
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    throw new BridgeTransportError(
      "DISCONNECTED",
      timedOut
        ? "The Desk host did not respond. Start the local bridge and try again."
        : "The Desk host is unavailable or blocked by browser permission.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw transportErrorForStatus(response.status);
  return { requestId: message.requestId, status: response.status };
}
