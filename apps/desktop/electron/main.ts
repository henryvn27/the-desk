import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  shell,
  globalShortcut,
  screen,
  desktopCapturer,
  systemPreferences,
  dialog,
} from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { DeskStore } from "../../../packages/domain/store";
import { z } from "zod";
import { ProviderCredentials } from "./credentials";
import {
  askLens,
  lensInputSchema,
} from "../../../packages/intelligence/lens-provider";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "desk",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("The Desk V1");
if (process.env.DESK_DATA_DIR)
  app.setPath("userData", resolve(process.env.DESK_DATA_DIR));
if (!app.requestSingleInstanceLock()) app.exit(0);
let store: DeskStore;
let quitRequested = false;
app.on("before-quit", () => {
  quitRequested = true;
});
let main: BrowserWindow | null = null;
let lens: BrowserWindow | null = null;
let controller: BrowserWindow | null = null;
let lensRequest: AbortController | null = null;
const windows = new Set<BrowserWindow>();
function makeWindow(kind: "main" | "lens" | "controller") {
  const bounds =
    kind === "lens"
      ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds
      : undefined;
  const win = new BrowserWindow({
    ...(bounds ?? {
      width: kind === "controller" ? 400 : 1180,
      height: kind === "controller" ? 220 : 800,
    }),
    minWidth: kind === "main" ? 760 : undefined,
    minHeight: kind === "main" ? 580 : undefined,
    title: "The Desk",
    backgroundColor: kind === "lens" ? "#00000000" : "#F7F4ED",
    transparent: kind === "lens",
    frame: kind !== "lens",
    alwaysOnTop: kind !== "main",
    skipTaskbar: kind !== "main",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windows.add(win);
  win.on("closed", () => windows.delete(win));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  void win.loadURL(`desk://app/index.html#${kind}`);
  return win;
}
function showLens() {
  if (lens && !lens.isDestroyed()) {
    lens.focus();
    return;
  }
  lens = makeWindow("lens");
  lens.on("closed", () => {
    lensRequest?.abort();
    lens = null;
  });
}
app.whenReady().then(() => {
  const root = resolve(__dirname, "../dist");
  protocol.handle("desk", (request) => {
    const url = new URL(request.url);
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (url.host !== "app" || !file.startsWith(root + sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  session.defaultSession.setPermissionRequestHandler(
    (_web, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  mkdirSync(app.getPath("userData"), { recursive: true });
  store = new DeskStore(join(app.getPath("userData"), "desk.sqlite"));
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (
      ![...windows].some((w) => w.webContents === event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame.url.startsWith("desk://app/")
    )
      throw Error("Untrusted request");
  };
  const credentials = new ProviderCredentials(app.getPath("userData"));
  ipcMain.handle("desk:provider-status", (event) => {
    check(event);
    return credentials.status();
  });
  ipcMain.handle("desk:provider-save", (event, key) => {
    check(event);
    if (event.sender !== main?.webContents)
      throw Error("Open Settings to connect a provider.");
    credentials.save(key);
  });
  ipcMain.handle("desk:provider-remove", (event) => {
    check(event);
    if (event.sender !== main?.webContents)
      throw Error("Open Settings to disconnect a provider.");
    credentials.remove();
  });
  ipcMain.handle("desk:ask-lens", async (event, value) => {
    check(event);
    if (event.sender !== lens?.webContents)
      throw Error("Open Lens to ask a question.");
    if (lensRequest) throw Error("A Lens response is already in progress.");
    const snapshot = store.snapshot();
    const active = snapshot.sessions.find((s) => !s.endedAt);
    const task = snapshot.tasks.find((t) => t.id === active?.taskId);
    const course = snapshot.classes.find((c) => c.id === task?.classId);
    const input = lensInputSchema.parse({
      ...value,
      context: task
        ? JSON.stringify({
            class: course?.name,
            task: task.title,
            notesExcerpt: task.notes.slice(0, 12000),
            notesTruncated: task.notes.length > 12000,
            resource: task.resource,
          })
        : "No active academic session. Ask if academic context is unclear.",
    });
    const key = credentials.read();
    lensRequest = new AbortController();
    try {
      return await askLens(input, key, {
        signal: lensRequest.signal,
        onTelemetry: (event) => store.recordAI(event, active?.id ?? null),
      });
    } finally {
      lensRequest = null;
    }
  });
  ipcMain.handle("desk:close-window", (event) => {
    check(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    // Reply before destroying the IPC sender. Preserve native Quit intent after
    // the renderer canceled the first close to finish its pending save.
    setImmediate(() => {
      if (quitRequested) app.quit();
      else if (owner && !owner.isDestroyed()) owner.close();
    });
  });
  ipcMain.handle("desk:snapshot", (event) => {
    check(event);
    return store.snapshot();
  });
  ipcMain.handle("desk:canvas", (event, id) => {
    check(event);
    return store.canvas(z.string().uuid().parse(id));
  });
  ipcMain.handle("desk:canvas-export", async (event, id, raw) => {
    check(event);
    const board = store.canvas(z.string().uuid().parse(id));
    if (
      !(raw instanceof Uint8Array) ||
      raw.byteLength > 20 * 1024 * 1024 ||
      raw.byteLength < 24
    )
      throw Error("Invalid canvas PNG.");
    const png = Buffer.from(raw);
    if (
      png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      png.toString("ascii", 12, 16) !== "IHDR"
    )
      throw Error("Invalid canvas PNG.");
    const width = png.readUInt32BE(16),
      height = png.readUInt32BE(20);
    if (!width || !height || width * height > 30000000)
      throw Error("Canvas image is too large to export.");
    const owner = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showSaveDialog(owner, {
      title: "Export canvas",
      defaultPath:
        board.title.replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 100) + ".png",
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, png);
    return true;
  });
  ipcMain.handle("desk:command", (event, value) => {
    check(event);
    const state = store.execute(value);
    if (
      state.sessions.some((s) => !s.endedAt) &&
      (!controller || controller.isDestroyed())
    ) {
      controller = makeWindow("controller");
      controller.on("closed", () => {
        controller = null;
      });
    }
    if (!state.sessions.some((s) => !s.endedAt) && controller) {
      controller.close();
      controller = null;
    }
    return state;
  });
  ipcMain.handle("desk:resource", async (event, value) => {
    check(event);
    const id = z.string().uuid().parse(value);
    const resource = store.snapshot().tasks.find((t) => t.id === id)?.resource;
    if (!resource) throw Error("This task has no resource link.");
    const url = new URL(resource);
    if (url.protocol !== "https:" || url.username || url.password)
      throw Error("Invalid resource URL.");
    await shell.openExternal(url.href);
  });
  ipcMain.handle("desk:lens", (event) => {
    check(event);
    showLens();
  });
  ipcMain.handle("desk:capture-screen", async (event) => {
    check(event);
    if (!lens || lens.webContents !== event.sender)
      throw Error("Open Lens to capture a screen.");
    if (
      process.platform === "darwin" &&
      systemPreferences.getMediaAccessStatus("screen") !== "granted"
    )
      throw Error(
        "Screen Recording permission is required. Enable The Desk V1 in System Settings → Privacy & Security → Screen Recording, then reopen the app.",
      );
    const target = lens;
    const display = screen.getDisplayMatching(target.getBounds());
    target.hide();
    try {
      // One explicit still image, never a stream or background recording.
      await new Promise((resolve) => setTimeout(resolve, 120));
      const ratio = Math.min(1, 1920 / display.size.width);
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: {
          width: Math.round(display.size.width * ratio),
          height: Math.round(display.size.height * ratio),
        },
      });
      const source = sources.find((s) => s.display_id === String(display.id));
      if (!source || source.thumbnail.isEmpty())
        throw Error(
          "The selected display could not be captured. No image was saved.",
        );
      const size = source.thumbnail.getSize();
      return {
        image: source.thumbnail.toDataURL(),
        width: size.width,
        height: size.height,
        displayId: String(display.id),
        capturedAt: new Date().toISOString(),
      };
    } finally {
      if (!target.isDestroyed()) target.show();
    }
  });
  ipcMain.handle("desk:dismiss", (event) => {
    check(event);
    if (lens?.webContents === event.sender) lens.close();
  });
  main = makeWindow("main");
  if (store.snapshot().sessions.some((s) => !s.endedAt)) {
    controller = makeWindow("controller");
    controller.on("closed", () => {
      controller = null;
    });
  }
  main.on("closed", () => {
    main = null;
  });
  globalShortcut.register("Alt+Space", showLens);
  app.on("second-instance", () => {
    main?.show();
    main?.focus();
  });
  app.on("activate", () => {
    if (!main) main = makeWindow("main");
    else main.show();
  });
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  store?.close();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
