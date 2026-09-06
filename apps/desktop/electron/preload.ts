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
  exportCalendar: () => ipcRenderer.invoke("desk:calendar-export"),
  deleteLocalData: () => ipcRenderer.invoke("desk:data-delete"),
  canvas: (id) => ipcRenderer.invoke("desk:canvas", id),
  askLens: (input) => ipcRenderer.invoke("desk:ask-lens", input),
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
  previewRebalance: () => ipcRenderer.invoke("desk:rebalance-preview"),
  snapshot: () => ipcRenderer.invoke("desk:snapshot"),
  command: (value) => ipcRenderer.invoke("desk:command", value),
  openResource: (id) => ipcRenderer.invoke("desk:resource", id),
  lens: () => ipcRenderer.invoke("desk:lens"),
  dismiss: () => ipcRenderer.invoke("desk:dismiss"),
};
contextBridge.exposeInMainWorld("desk", api);
