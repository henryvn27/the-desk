import { lensContext } from "../../../packages/intelligence/grounding";
import { readCaptureTextFiles } from "../../../packages/intake/text-files";
import {
  app,
  BrowserWindow,
  Menu,
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
import { rm, writeFile } from "node:fs/promises";
import { DeskStore } from "../../../packages/domain/store";
import { studyBlocksToIcs } from "../../../packages/planner/calendar";
import { z } from "zod";
import { ProviderCredentials } from "./credentials";
import { SupabaseAccount } from "./supabase";
import { SupabaseSyncCoordinator } from "./supabase-sync";
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
let databasePath = "";
let account: SupabaseAccount;
let sync: SupabaseSyncCoordinator;
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
      height: kind === "controller" ? 380 : 800,
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
  // Let renderer editors handle undo/redo. Native Edit-menu accelerators would
  // otherwise consume these keys before Excalidraw receives them. Other menu
  // shortcuts (including Quit) remain enabled on their own input events.
  win.webContents.on("before-input-event", (_event, input) => {
    const editShortcut =
      (input.control || input.meta) &&
      ["z", "y"].includes(input.key.toLowerCase());
    win.webContents.setIgnoreMenuShortcuts(editShortcut);
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
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      { role: "fileMenu" },
      {
        label: "Edit",
        submenu: [
          {
            id: "desk-undo",
            label: "Undo",
            accelerator: "CmdOrCtrl+Z",
            registerAccelerator: false,
            click: (_item, window) => {
              if (window instanceof BrowserWindow)
                window.webContents.send("desk:edit", "undo");
            },
          },
          {
            id: "desk-redo",
            label: "Redo",
            accelerator: "CmdOrCtrl+Shift+Z",
            registerAccelerator: false,
            click: (_item, window) => {
              if (window instanceof BrowserWindow)
                window.webContents.send("desk:edit", "redo");
            },
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { type: "separator" },
          { role: "selectAll" },
        ],
      },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
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
  databasePath = join(app.getPath("userData"), "desk.sqlite");
  store = new DeskStore(databasePath);
  const check = (event: Electron.IpcMainInvokeEvent) => {
    if (
      ![...windows].some((w) => w.webContents === event.sender) ||
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame.url.startsWith("desk://app/")
    )
      throw Error("Untrusted request");
  };
  const credentials = new ProviderCredentials(
    app.getPath("userData"),
    app.isPackaged || process.env.DESK_ENABLE_DEVELOPMENT_KEY !== "1"
      ? undefined
      : join(app.getAppPath(), ".env.local"),
  );
  account = new SupabaseAccount(
    app.getPath("userData"),
    app.isPackaged || process.env.DESK_ENABLE_DEVELOPMENT_KEY !== "1"
      ? undefined
      : join(app.getAppPath(), ".env.local"),
  );
  sync = new SupabaseSyncCoordinator(() => store, account);
  ipcMain.handle("desk:capture-import", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Capture in the main Desk window to import files.");
    const selection = await dialog.showOpenDialog(main, {
      title: "Import academic text",
      buttonLabel: "Import",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Text and Markdown", extensions: ["txt", "md"] }],
    });
    if (selection.canceled || !selection.filePaths.length) return null;
    const files = await readCaptureTextFiles(selection.filePaths);
    return store.execute({
      type: "inbox.import",
      files,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });
  ipcMain.handle("desk:provider-status", (event) => {
    check(event);
    return credentials.status();
  });
  ipcMain.handle("desk:account-status", (event) => {
    check(event);
    // Account settings are an explicit request for secure-storage capability;
    // the background sync poll uses the lazy non-probing status path so a
    // fresh local-first launch does not open a macOS Keychain prompt.
    return account.status(true);
  });
  ipcMain.handle("desk:account-sign-in", async (event, email, password) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings in the main Desk window to sign in.");
    const result = await account.signIn(email, password);
    sync.schedule();
    return result;
  });
  ipcMain.handle("desk:account-sign-up", async (event, email, password) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings in the main Desk window to create an account.");
    const result = await account.signUp(email, password);
    sync.schedule();
    return result;
  });
  ipcMain.handle("desk:account-sign-out", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings in the main Desk window to sign out.");
    const result = await account.signOut();
    sync.close();
    return result;
  });
  ipcMain.handle("desk:sync-status", (event) => {
    check(event);
    return sync.status();
  });
  ipcMain.handle("desk:sync-now", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings in the main Desk window to sync.");
    return sync.syncNow();
  });
  ipcMain.handle("desk:provider-import", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings to connect a provider.");
    const result = await dialog.showOpenDialog(main, {
      title: "Import OpenRouter key",
      properties: ["openFile"],
      buttonLabel: "Import key",
    });
    if (result.canceled || !result.filePaths[0]) return false;
    credentials.importFile(result.filePaths[0]);
    return true;
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
    const input = lensInputSchema.parse({ ...value, context: undefined });
    input.context = lensContext(snapshot, input.question);
    const key = credentials.read();
    lensRequest = new AbortController();
    try {
      return await askLens(input, key, {
        tutoringMode: snapshot.tutoringMode,
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
  ipcMain.handle("desk:rebalance-preview", (event) => {
    check(event);
    return store.previewRebalance();
  });
  ipcMain.handle("desk:snapshot", (event) => {
    check(event);
    return store.snapshot();
  });
  ipcMain.handle("desk:data-export", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings in the main Desk window to export data.");
    const result = await dialog.showSaveDialog(main, {
      title: "Export local Desk data",
      defaultPath: "the-desk-data.json",
      filters: [{ name: "JSON data", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(
      result.filePath,
      JSON.stringify(
        {
          format: "the-desk-local-export",
          version: 1,
          exportedAt: new Date().toISOString(),
          snapshot: store.snapshot(),
        },
        null,
        2,
      ),
      "utf8",
    );
    return true;
  });
  ipcMain.handle("desk:calendar-export", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Plan in the main Desk window to export the study plan.");
    const state = store.snapshot();
    const result = await dialog.showSaveDialog(main, {
      title: "Export study plan",
      defaultPath: "the-desk-study-plan.ics",
      filters: [{ name: "Calendar file", extensions: ["ics"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(
      result.filePath,
      studyBlocksToIcs(state.studyBlocks, state.tasks, state.classes),
      "utf8",
    );
    return true;
  });
  ipcMain.handle("desk:data-delete", async (event) => {
    check(event);
    if (event.sender !== main?.webContents || !main)
      throw Error("Open Settings in the main Desk window to delete local data.");
    const result = await dialog.showMessageBox(main, {
      type: "warning",
      title: "Delete local Desk data?",
      message: "Delete the local academic workspace from this Mac?",
      detail:
        "This removes classes, tasks, sources, sessions, settings and local sync history. Export first if you may need a copy.",
      buttons: ["Cancel", "Delete local data"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return store.snapshot();
    store.close();
    await Promise.all([
      rm(databasePath, { force: true }),
      rm(`${databasePath}-wal`, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
    ]);
    store = new DeskStore(databasePath);
    sync.schedule();
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
    sync.schedule();
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
  sync.schedule();
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
  sync?.close();
  store?.close();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
