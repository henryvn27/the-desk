import { waitFor } from "./wait-for.mjs";
import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-canvas-"));
const output = resolve("artifacts/canvas");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data },
    recordVideo: { dir: output },
  });
  page = await app.firstWindow();
  await page.getByText("Make room for focus.", { exact: true }).waitFor();
  page.on("pageerror", (e) => errors.push(e.message));
  // Electron handles beforeunload without a browser dialog. Prevent Playwright
  // from auto-dismissing a transient protocol event after the save closes it.
  page.on("dialog", (dialog) => {
    assert.equal(dialog.type(), "beforeunload");
  });
}
try {
  await launch();
  await page.evaluate(async () => {
    let s = await window.desk.command({
      type: "class.create",
      name: "Physics",
    });
    await window.desk.command({
      type: "task.create",
      input: {
        title: "Vector sketch",
        classId: s.classes[0].id,
        dueAt: null,
        minutes: 30,
        deadlineConfirmed: true,
        resource: null,
        notes: "",
      },
    });
  });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await page.getByRole("dialog", { name: "Study canvas" }).waitFor();
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.getByTestId("toolbar-freedraw").locator("..").click();
  await page.mouse.move(420, 300);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++)
    await page.mouse.move(420 + i * 5, 300 + Math.sin(i / 4) * 40);
  await page.mouse.up();
  await page.getByTestId("toolbar-arrow").locator("..").click();
  await page.mouse.move(440, 440);
  await page.mouse.down();
  await page.mouse.move(610, 350);
  await page.mouse.up();
  await page.getByTestId("toolbar-rectangle").locator("..").click();
  await page.mouse.move(680, 300);
  await page.mouse.down();
  await page.mouse.move(800, 440);
  await page.mouse.up();
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(modifier + "+z");
  await page.keyboard.press(modifier + "+Shift+z");
  await page.getByRole("button", { name: "Highlighter", exact: true }).click();
  await page.mouse.move(420, 400);
  await page.mouse.down();
  await page.mouse.move(610, 400);
  await page.mouse.up();
  await page.keyboard.press(modifier + "+z");
  await page.keyboard.press(modifier + "+Shift+z");
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await page.mouse.move(420, 635);
  await page.mouse.down();
  await page.mouse.move(610, 635);
  await page.mouse.up();
  await page.keyboard.press(modifier + "+z");
  await page.keyboard.press(modifier + "+Shift+z");
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  const id = snapshot.canvases[0].id;
  const before = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.equal(before.scene.elements.filter((e) => !e.isDeleted).length, 5);
  assert.ok(
    before.scene.elements.some(
      (e) => e.type === "freedraw" && e.points.length > 10,
    ),
  );
  assert.ok(
    before.scene.elements.some(
      (e) =>
        !e.isDeleted &&
        e.type === "freedraw" &&
        e.opacity === 35 &&
        e.strokeWidth === 8 &&
        e.strokeColor === "#ffd43b",
    ),
    "Highlighter must retain broad translucent yellow ink",
  );
  assert.ok(
    before.scene.elements.some(
      (e) =>
        !e.isDeleted &&
        e.type === "freedraw" &&
        e.opacity === 100 &&
        e.strokeWidth === 2 &&
        e.strokeColor === "#1e1e1e",
    ),
    "Pen must restore opaque dark ink",
  );
  await app.close();
  await page.video().saveAs(join(output, "canvas-drawing.webm"));
  await launch();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor();
  const after = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.deepEqual(after.scene, before.scene);
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "canvas.png") });
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: "" });
  });
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  await page.getByText("Export canceled", { exact: true }).waitFor();
  const exported = join(data, "export.png");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exported);
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  await page.getByText("PNG exported", { exact: true }).waitFor();
  const bytes = await readFile(exported);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(bytes.readUInt32BE(16) > 100 && bytes.readUInt32BE(20) > 100);
  await copyFile(exported, join(output, "exported-board.png"));
  await page.getByTestId("toolbar-text").locator("..").click();
  await page.mouse.click(420, 520);
  await page.keyboard.type("F = ma");
  await page.keyboard.press("Escape");
  // Chromium's File System Access picker does not emit Playwright filechooser.
  // Supply its file result; the editor still decodes/imports the real exported PNG.
  await page.evaluate(
    (png) => {
      window.showOpenFilePicker = async () => [
        {
          getFile: async () =>
            new File([Uint8Array.from(png)], "board.png", {
              type: "image/png",
            }),
        },
      ];
    },
    [...bytes],
  );
  await page.getByTestId("toolbar-image").locator("..").click();
  await waitFor(async () => {
    const record = await page.evaluate((id) => window.desk.canvas(id), id);
    return Object.keys(record.scene.files).length === 1;
  }, "Imported image was not saved");
  await page.mouse.click(900, 530);
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  const withMedia = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.ok(
    withMedia.scene.elements.some(
      (e) => !e.isDeleted && e.type === "text" && e.text === "F = ma",
    ),
  );
  assert.ok(
    withMedia.scene.elements.some((e) => !e.isDeleted && e.type === "image"),
  );
  assert.equal(Object.keys(withMedia.scene.files).length, 1);
  await app.close();
  await page.video().saveAs(join(output, "canvas-media.webm"));
  await launch();
  const restoredMedia = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.deepEqual(restoredMedia.scene, withMedia.scene);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor();
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
  // The desktop CSP permits only packaged fonts. Custom-protocol requests are
  // not reliably represented in Chromium Resource Timing; inspect the font set.
  const fontLoaded = await page.evaluate(async () => {
    const faces = await document.fonts.load("20px Excalifont", "F = ma");
    return faces.length > 0 && faces.every((face) => face.status === "loaded");
  });
  assert.equal(
    fontLoaded,
    true,
    "Excalifont must load under the local-only CSP",
  );
  await page.screenshot({ path: join(output, "canvas-media.png") });
  const sourceId = await page.evaluate(async () => {
    const state = await window.desk.snapshot();
    const next = await window.desk.command({
      type: "source.create",
      input: {
        title: "Newton's second law",
        text: "The net force equals mass times acceleration. Preserve this original passage.",
        classIds: [state.classes[0].id],
        taskIds: [state.tasks[0].id],
      },
    });
    return next.sources[0].id;
  });
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page.getByLabel("Link a Library source").selectOption(sourceId);
  await page
    .getByRole("complementary", { name: "Canvas sources" })
    .getByText(
      "The net force equals mass times acceleration. Preserve this original passage.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "canvas-sources.png") });
  await page.getByRole("button", { name: "Sources", exact: true }).click();

  // Hold only the 500 ms autosave debounce so Quit deterministically races a
  // pending edit. The close guard must flush it without waiting for the timer.
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) =>
      schedule(fn, delay === 500 ? 60_000 : delay, ...args);
  });
  await page.getByTestId("toolbar-ellipse").locator("..").click();
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(360, 360);
  await page.mouse.up();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Unsaved changes", { exact: true })
    .waitFor();
  const quitting = app.waitForEvent("close");
  await app.evaluate(({ app }) => {
    setImmediate(() => app.quit());
  });
  await quitting;
  await page.video().saveAs(join(output, "canvas-native-quit.webm"));
  await launch();
  const afterQuit = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.ok(
    afterQuit.scene.elements.some((e) => !e.isDeleted && e.type === "ellipse"),
    "Native Quit must flush the pending ellipse",
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor();
  // Let engine hydration normalization settle before recording the scene that
  // another writer owns. Compare the failed save to this exact stored baseline.
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
  // Simulate another writer advancing the revision while this editor is open.
  const staleBaseline = await page.evaluate(async (id) => {
    const record = await window.desk.canvas(id);
    await window.desk.command({
      type: "canvas.save",
      id,
      revision: record.revision,
      scene: record.scene,
    });
    return record.scene;
  }, id);
  await page.getByTestId("toolbar-diamond").locator("..").click();
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(260, 360);
  await page.mouse.up();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await page.getByRole("alert").waitFor();
  assert.equal(page.isClosed(), false, "Failed save must keep the editor open");
  const failedSave = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.deepEqual(
    failedSave.scene,
    staleBaseline,
    "Stale editor must not overwrite saved work",
  );
  await page.screenshot({ path: join(output, "canvas-close-error.png") });
  await page
    .getByRole("button", { name: "Save recovery copy and close", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Open Vector sketch (recovery copy)",
      exact: true,
    })
    .click();
  await page.locator(".excalidraw canvas").first().waitFor();
  const recoveredSnapshot = await page.evaluate(() => window.desk.snapshot());
  const recovered = recoveredSnapshot.canvases.find((c) => c.id !== id);
  assert.ok(recovered, "Recovery copy must be accessible from Library");
  const recoveredRecord = await page.evaluate(
    (id) => window.desk.canvas(id),
    recovered.id,
  );
  assert.ok(
    recoveredRecord.scene.elements.some(
      (e) => !e.isDeleted && e.type === "diamond",
    ),
  );
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), id)).scene,
    staleBaseline,
  );
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
  const savedRecovery = await page.evaluate(
    (id) => window.desk.canvas(id),
    recovered.id,
  );
  await page.screenshot({ path: join(output, "canvas-recovered.png") });
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  await app.close();
  await page.video().saveAs(join(output, "canvas-recovery.webm"));
  await launch();
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), recovered.id)).scene,
    savedRecovery.scene,
  );
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), recovered.id)).scene
      .sourceIds,
    [sourceId],
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page
    .getByRole("button", { name: "Unlink Newton's second law", exact: true })
    .click();
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), id)).scene.sourceIds,
    [],
  );
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).sources[0].id,
    sourceId,
    "Unlink must preserve the Library source",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify({
      result: "PASS",
      flows: [
        "ink",
        "explicit pen/highlighter, undo-redo and restart",
        "arrow",
        "rectangle",
        "undo/redo",
        "flush on close",
        "exact scene across restart",
        "PNG export and canceled dialog result",
        "text and PNG import survive restart",
        "packaged text font loaded",
        "Canvas source links persist through restart/recovery; unlink preserves Library source",
        "native Quit flushes a pending edit",
        "failed save prevents native window close and preserves stored scene",
        "recovery copy preserves unsaved drawing without overwriting original and survives restart",
      ],
      limitations: [
        "not complete Canvas acceptance",
        "native save-dialog and image-picker results injected; native picker interaction/PDF/math/Windows not tested",
      ],
    }),
  );
} catch (error) {
  // A deliberately failed save prevents graceful close. Terminate only this
  // isolated fixture app so teardown cannot hide the original assertion.
  if (app) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
  app = undefined;
  throw new Error(error.message);
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
