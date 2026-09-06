import type { BrowserBridgeMessage } from "../../../packages/integrations/browser-bridge";
import { chrome } from "./chrome-api";
import {
  BridgeTransportError,
  loadBridgeSettings,
  saveBridgeSettings,
} from "./transport";
import type { ExtensionResponse } from "./background";

function element<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing bridge popup control: ${selector}`);
  return value;
}

const endpointInput = element<HTMLInputElement>("#endpoint");
const tokenInput = element<HTMLInputElement>("#token");
const saveButton = element<HTMLButtonElement>("#save");
const captureButton = element<HTMLButtonElement>("#capture");
const sendButton = element<HTMLButtonElement>("#send");
const statusText = element<HTMLElement>("#status");
const pageTitle = element<HTMLElement>("#page-title");
const pageUrl = element<HTMLElement>("#page-url");
const selectionPreview = element<HTMLElement>("#selection");
const visibleSummary = element<HTMLElement>("#visible-summary");

let pendingMessage: BrowserBridgeMessage | null = null;

function setStatus(message: string, kind: "quiet" | "success" | "error" = "quiet") {
  statusText.textContent = message;
  statusText.dataset.kind = kind;
}

function setBusy(busy: boolean) {
  captureButton.disabled = busy;
  saveButton.disabled = busy;
  sendButton.disabled = busy || pendingMessage === null;
}

function displayFailure(response: ExtensionResponse) {
  if (response.ok) return;
  setStatus(response.message, "error");
}

function renderPreview(message: BrowserBridgeMessage) {
  const context = message.context;
  pageTitle.textContent = context.title || "Untitled page";
  pageUrl.textContent = context.url;
  selectionPreview.textContent = context.selectionText
    ? context.selectionText.slice(0, 4_000)
    : "No text is selected. You can still send the visible page text.";
  visibleSummary.textContent = context.visibleText
    ? `${context.visibleText.length.toLocaleString()} characters of visible page text ready.`
    : "No visible page text was found.";
  sendButton.disabled = false;
}

async function saveSettings(showStatus: boolean): Promise<boolean> {
  try {
    const settings = await saveBridgeSettings(chrome.storage.local, {
      endpoint: endpointInput.value,
      token: tokenInput.value,
    });
    endpointInput.value = settings.endpoint;
    tokenInput.value = settings.token;
    if (showStatus) setStatus("Bridge settings saved.", "success");
    return true;
  } catch (error) {
    const message =
      error instanceof BridgeTransportError
        ? error.message
        : "The bridge settings could not be saved.";
    setStatus(message, "error");
    return false;
  }
}

async function loadSettings() {
  try {
    const settings = await loadBridgeSettings(chrome.storage.local);
    endpointInput.value = settings.endpoint;
    tokenInput.value = settings.token;
  } catch {
    endpointInput.value = "";
    tokenInput.value = "";
    setStatus("Enter a loopback bridge endpoint to begin.", "error");
  }
}

captureButton.addEventListener("click", async () => {
  pendingMessage = null;
  sendButton.disabled = true;
  setBusy(true);
  setStatus("Reading the active page and current selection…");
  try {
    const response = await chrome.runtime.sendMessage<ExtensionResponse>({
      type: "capture-active-tab",
    });
    if (!response || !response.ok || !response.message) {
      if (response) displayFailure(response);
      else setStatus("The extension could not reach its capture worker.", "error");
      return;
    }
    pendingMessage = response.message;
    renderPreview(response.message);
    setStatus("Review the capture, then send it to Desk.", "success");
  } catch {
    setStatus("The extension could not reach its capture worker.", "error");
  } finally {
    setBusy(false);
  }
});

sendButton.addEventListener("click", async () => {
  if (!pendingMessage) return;
  if (!(await saveSettings(false))) return;
  setBusy(true);
  setStatus("Sending the reviewed capture to Desk…");
  try {
    const response = await chrome.runtime.sendMessage<ExtensionResponse>({
      type: "send-context",
      message: pendingMessage,
    });
    if (!response || !response.ok) {
      if (response) displayFailure(response);
      else setStatus("The Desk bridge did not respond.", "error");
      return;
    }
    setStatus("Capture sent to Desk. Review it in Capture Inbox.", "success");
  } catch {
    setStatus("The Desk bridge did not respond.", "error");
  } finally {
    setBusy(false);
  }
});

saveButton.addEventListener("click", () => {
  void saveSettings(true);
});

void loadSettings();
