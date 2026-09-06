import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-notebook-"));
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
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (dialog) => assert.equal(dialog.type(), "beforeunload"));
  await page.getByText("Make room for focus.", { exact: true }).waitFor();
}
async function save() {
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
}
async function draw(tool) {
  await page.getByTestId(`toolbar-${tool}`).locator("..").click();
  const box = await page.locator(".excalidraw canvas").first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.54, box.y + box.height * 0.42, {
    steps: 8,
  });
  await page.mouse.up();
}
try {
  await launch();
  await page.evaluate(async () => {
    const state = await window.desk.command({
      type: "class.create",
      name: "Physics",
    });
    await window.desk.command({
      type: "task.create",
      input: {
        title: "Motion lab",
        classId: state.classes[0].id,
        dueAt: null,
        minutes: 30,
        deadlineConfirmed: true,
        resource: null,
        notes: "",
      },
    });
  });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page.getByRole("navigation", { name: "Notebook pages" }).waitFor();
  await page.locator(".excalidraw canvas").first().waitFor();
  const id = (await page.evaluate(() => window.desk.snapshot())).canvases[0].id;
  await draw("rectangle");
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await page.getByLabel("LaTeX equation").fill(String.raw`a=\frac{F}{m}`);
  await page
    .getByRole("button", { name: "Insert equation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Math block" })
    .waitFor({ state: "hidden" });
  await save();
  const first = await page.evaluate((id) => window.desk.canvas(id), id);
  const firstId = first.scene.notebook.activePageId;
  assert.equal(
    first.scene.notebook.pages[0].elements.filter(
      (e) => !e.isDeleted && e.type === "rectangle",
    ).length,
    1,
  );
  assert.equal(first.scene.elements.length, 0);
  assert.equal(Object.keys(first.scene.files).length, 1);
  await page.screenshot({ path: join(output, "notebook-page-one.png") });
  await page.getByRole("button", { name: "Add page", exact: true }).click();
  await page
    .getByLabel("Page", { exact: true })
    .selectOption({ label: "Page 2" });
  await draw("ellipse");
  await save();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await save();
  assert.equal(
    (
      await page.evaluate((id) => window.desk.canvas(id), id)
    ).scene.notebook.pages[1].elements.filter((e) => !e.isDeleted).length,
    0,
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z",
  );
  await save();
  const second = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.deepEqual(second.scene.files, first.scene.files);
  assert.equal(second.scene.notebook.pages.length, 2);
  assert.deepEqual(
    second.scene.notebook.pages[0],
    first.scene.notebook.pages[0],
  );
  assert.equal(
    second.scene.notebook.pages[1].elements.filter(
      (e) => !e.isDeleted && e.type === "ellipse",
    ).length,
    1,
  );
  const path = join(data, "page.png");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, path);
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  await page.getByText("PNG exported", { exact: true }).waitFor();
  const png = await readFile(path);
  assert.equal(png.readUInt32BE(16), 794);
  assert.equal(png.readUInt32BE(20), 1123);
  await copyFile(path, join(output, "notebook-export.png"));
  await page.screenshot({ path: join(output, "notebook-page-two.png") });
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  const persisted = await page.evaluate((id) => window.desk.canvas(id), id);
  await app.close();
  await page.video().saveAs(join(output, "notebook-pages.webm"));
  await launch();
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), id)).scene,
    persisted.scene,
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await save();
  const hydrated = await page.evaluate((id) => window.desk.canvas(id), id);
  await page.getByLabel("Page", { exact: true }).selectOption(firstId);
  await save();
  const returned = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.equal(returned.scene.notebook.activePageId, firstId);
  assert.deepEqual(
    returned.scene.notebook.pages[1],
    hydrated.scene.notebook.pages[1],
  );
  assert.equal(
    returned.scene.notebook.pages[0].elements.filter(
      (e) => !e.isDeleted && e.type === "rectangle",
    ).length,
    1,
  );
  await page.evaluate(async (id) => {
    const record = await window.desk.canvas(id);
    await window.desk.command({
      type: "canvas.save",
      id,
      revision: record.revision,
      scene: record.scene,
    });
  }, id);
  await draw("diamond");
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), id)).scene,
    returned.scene,
  );
  await page
    .getByRole("button", { name: "Save recovery copy and close", exact: true })
    .click();
  const recoveryId = (
    await page.evaluate(() => window.desk.snapshot())
  ).canvases.find((c) => c.id !== id).id;
  const recovered = await page.evaluate(
    (id) => window.desk.canvas(id),
    recoveryId,
  );
  assert.equal(
    recovered.scene.notebook.pages[0].elements.filter(
      (e) => !e.isDeleted && e.type === "diamond",
    ).length,
    1,
  );
  assert.deepEqual(
    recovered.scene.notebook.pages[1],
    returned.scene.notebook.pages[1],
  );
  assert.deepEqual(recovered.scene.files, returned.scene.files);
  await app.close();
  await page.video().saveAs(join(output, "notebook-recovery.webm"));
  await launch();
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), recoveryId)).scene,
    recovered.scene,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify({
      result: "PASS",
      flows: [
        "create bounded notebook",
        "draw on two isolated pages",
        "inactive page preserved",
        "selected page PNG dimensions",
        "restart persistence",
        "return to first page",
        "shared math image retained across pages",
        "current page keyboard undo/redo",
        "failed save preserves original; recovery retains all pages and images after restart",
      ],
      limitations: [
        "native export dialog result injected",
        "Windows interactions and complete Canvas acceptance unverified",
      ],
    }),
  );
} catch (error) {
  console.error(error.stack);
  if (app) await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
  app = undefined;
  throw new Error(error.message);
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
