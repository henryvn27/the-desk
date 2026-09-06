import {
  browserPageContext,
  type BrowserBridgeMessage,
} from "../../../packages/integrations/browser-bridge";
import { browserForUserAgent, capturePage, adapterForUrl } from "./capture";
import { chrome, type ChromeTab } from "./chrome-api";
import {
  BridgeTransportError,
  loadBridgeSettings,
  sendBrowserContext,
} from "./transport";

type ExtensionRequest =
  | { type: "capture-active-tab" }
  | { type: "send-context"; message: unknown };

interface SuccessResponse {
  ok: true;
  message?: BrowserBridgeMessage;
  status?: number;
}

interface FailureResponse {
  ok: false;
  code: string;
  message: string;
}

export type ExtensionResponse = SuccessResponse | FailureResponse;

class ExtensionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
  }
}

function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return type === "capture-active-tab" || type === "send-context";
}

function httpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function browserContextForTab(
  tab: ChromeTab,
  page: ReturnType<typeof capturePage>,
): BrowserBridgeMessage {
  if (typeof tab.id !== "number" || !httpUrl(page.url)) {
    throw new ExtensionError(
      "PAGE_UNAVAILABLE",
      "Open a regular HTTP(S) page before capturing.",
    );
  }

  try {
    return {
      version: 1,
      requestId: crypto.randomUUID(),
      type: "page-context",
      context: browserPageContext.parse({
        browser: browserForUserAgent(navigator.userAgent),
        tabId: String(tab.id),
        url: page.url,
        title: page.title || tab.title || "",
        selectionText: page.selectionText,
        visibleText: page.visibleText,
        capturedAt: new Date().toISOString(),
        adapter: adapterForUrl(page.url),
      }),
    };
  } catch {
    throw new ExtensionError(
      "PAGE_UNAVAILABLE",
      "The page changed while it was being captured. Try again.",
    );
  }
}

async function captureActiveTab(): Promise<BrowserBridgeMessage> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== "number") {
    throw new ExtensionError(
      "NO_ACTIVE_TAB",
      "No active browser tab is available for capture.",
    );
  }
  if (!httpUrl(tab.url ?? "")) {
    throw new ExtensionError(
      "PAGE_UNAVAILABLE",
      "Open a regular HTTP(S) page before capturing.",
    );
  }

  let result: Array<{ result?: ReturnType<typeof capturePage> }>;
  try {
    result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
    });
  } catch {
    throw new ExtensionError(
      "PAGE_ACCESS_DENIED",
      "The browser denied page access. Keep this tab active and try again.",
    );
  }

  const page = result[0]?.result;
  if (!page || typeof page.url !== "string") {
    throw new ExtensionError(
      "PAGE_UNAVAILABLE",
      "The active page could not be captured. Try again.",
    );
  }
  return browserContextForTab(tab, page);
}

function failureResponse(error: unknown): FailureResponse {
  if (error instanceof ExtensionError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof BridgeTransportError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return {
    ok: false,
    code: "BRIDGE_ERROR",
    message: "The Desk browser bridge could not complete this request.",
  };
}

async function handleRequest(request: ExtensionRequest): Promise<ExtensionResponse> {
  if (request.type === "capture-active-tab") {
    return { ok: true, message: await captureActiveTab() };
  }

  const settings = await loadBridgeSettings(chrome.storage.local);
  const receipt = await sendBrowserContext(request.message, settings);
  return { ok: true, status: receipt.status };
}

chrome.runtime.onMessage.addListener((value, _sender, sendResponse) => {
  if (!isExtensionRequest(value)) return;
  void handleRequest(value)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse(failureResponse(error)));
  return true;
});
