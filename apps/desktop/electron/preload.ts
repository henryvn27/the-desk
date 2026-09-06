import { contextBridge, ipcRenderer } from "electron";
import type { DeskAPI } from "../../../packages/domain/contracts";
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
  canvas: (id) => ipcRenderer.invoke("desk:canvas", id),
  askLens: (input) => ipcRenderer.invoke("desk:ask-lens", input),
  providerStatus: () => ipcRenderer.invoke("desk:provider-status"),
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
