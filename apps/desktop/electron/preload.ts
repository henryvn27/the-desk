import { contextBridge, ipcRenderer } from "electron";
import type { DeskAPI } from "../../../packages/domain/contracts";
import { parseBrowserBridgeMessage } from "../../../packages/integrations/browser-bridge";
const api: DeskAPI = {
  onEdit: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (action === "undo" || action === "redo") listener(action);
    };
    ipcRenderer.on("desk:edit", receive);
    return () => ipcRenderer.removeListener("desk:edit", receive);
  },
  closeWindow: () => ipcRenderer.invoke("desk:close-window"),
  exportCanvas: (id, png) => ipcRenderer.invoke("desk:canvas-export", id, png),
  exportData: () => ipcRenderer.invoke("desk:data-export"),
  exportRecordings: () => ipcRenderer.invoke("desk:recording-export"),
  exportCalendar: () => ipcRenderer.invoke("desk:calendar-export"),
  deleteLocalData: () => ipcRenderer.invoke("desk:data-delete"),
  canvas: (id) => ipcRenderer.invoke("desk:canvas", id),
  search: (query) => ipcRenderer.invoke("desk:search", query),
  intelligence: () => ipcRenderer.invoke("desk:intelligence"),
  chat: (input) => ipcRenderer.invoke("desk:chat", input),
  infer: (input) => ipcRenderer.invoke("desk:infer", input),
  askLens: (input) => ipcRenderer.invoke("desk:ask-lens", input),
  lensSubmit: (input) => ipcRenderer.invoke("desk:lens-submit", input),
  lensDraft: (selection, transcript) => ipcRenderer.invoke("desk:lens-draft", selection, transcript),
  lensSelectionFinished: () => ipcRenderer.invoke("desk:lens-selection-finished"),
  lensKeyUp: () => ipcRenderer.invoke("desk:lens-key-up"),
  lensHotkeyStatus: () => ipcRenderer.invoke("desk:lens-hotkey-status"),
  lensInteractionState: () => ipcRenderer.invoke("desk:lens-interaction-state"),
  onLensInteraction: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      listener(value as import("../../../packages/intelligence/lens-interaction").LensInteractionState);
    };
    ipcRenderer.on("desk:lens-interaction", receive);
    return () => ipcRenderer.removeListener("desk:lens-interaction", receive);
  },
  onLensAnswer: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      listener(value as import("../../../packages/intelligence/lens-provider").LensResponse);
    };
    ipcRenderer.on("desk:lens-answer", receive);
    return () => ipcRenderer.removeListener("desk:lens-answer", receive);
  },
  onLensError: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (typeof value === "string") listener(value);
    };
    ipcRenderer.on("desk:lens-error", receive);
    return () => ipcRenderer.removeListener("desk:lens-error", receive);
  },
  browserContext: () => ipcRenderer.invoke("desk:browser-context"),
  onBrowserContext: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = parseBrowserBridgeMessage(value);
      listener(parsed);
    };
    ipcRenderer.on("desk:browser-context", receive);
    return () => ipcRenderer.removeListener("desk:browser-context", receive);
  },
  onBrowserContextCleared: (listener) => {
    const receive = () => listener();
    ipcRenderer.on("desk:browser-context-clear", receive);
    return () => ipcRenderer.removeListener("desk:browser-context-clear", receive);
  },
  browserBridgeStatus: () => ipcRenderer.invoke("desk:browser-bridge-status"),
  clearBrowserContext: () => ipcRenderer.invoke("desk:browser-context-clear"),
  providerStatus: () => ipcRenderer.invoke("desk:provider-status"),
  accountStatus: () => ipcRenderer.invoke("desk:account-status"),
  accountSignIn: (email, password) =>
    ipcRenderer.invoke("desk:account-sign-in", email, password),
  accountSignUp: (email, password) =>
    ipcRenderer.invoke("desk:account-sign-up", email, password),
  accountSignOut: () => ipcRenderer.invoke("desk:account-sign-out"),
  syncStatus: () => ipcRenderer.invoke("desk:sync-status"),
  syncNow: () => ipcRenderer.invoke("desk:sync-now"),
  importCaptureFiles: () => ipcRenderer.invoke("desk:capture-import"),
  importProviderKey: () => ipcRenderer.invoke("desk:provider-import"),
  removeProviderKey: () => ipcRenderer.invoke("desk:provider-remove"),
  captureScreen: () => ipcRenderer.invoke("desk:capture-screen"),
  recordingStart: (canvasId, mimeType) => ipcRenderer.invoke("desk:recording-start", canvasId, mimeType),
  recordingChunk: (recordingId, chunkIndex, data) => ipcRenderer.invoke("desk:recording-chunk", recordingId, chunkIndex, data),
  recordingFinish: (recordingId, status) => ipcRenderer.invoke("desk:recording-finish", recordingId, status),
  recordingURL: (recordingId) => ipcRenderer.invoke("desk:recording-url", recordingId),
  previewRebalance: () => ipcRenderer.invoke("desk:rebalance-preview"),
  focusController: () => ipcRenderer.invoke("desk:focus-controller"),
  snapshot: () => ipcRenderer.invoke("desk:snapshot"),
  command: (value) => ipcRenderer.invoke("desk:command", value),
  openResource: (id) => ipcRenderer.invoke("desk:resource", id),
  lens: (input) => ipcRenderer.invoke("desk:lens", input),
  lensContext: () => ipcRenderer.invoke("desk:lens-context"),
  onLensContext: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const context = value as { question?: unknown; activityKind?: unknown; sourceIds?: unknown };
      listener({
        ...(typeof context.question === "string" ? { question: context.question } : {}),
        ...(typeof context.activityKind === "string" ? { activityKind: context.activityKind as import("../../../packages/study/activities").StudyActivityKind } : {}),
        ...(Array.isArray(context.sourceIds) && context.sourceIds.every((id) => typeof id === "string") ? { sourceIds: context.sourceIds as string[] } : {}),
      });
    };
    ipcRenderer.on("desk:lens-context", receive);
    return () => ipcRenderer.removeListener("desk:lens-context", receive);
  },
  dismiss: () => ipcRenderer.invoke("desk:dismiss"),
};
contextBridge.exposeInMainWorld("desk", api);
