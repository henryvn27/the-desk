import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir, readFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-math-"));
const output = resolve("artifacts/canvas");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
const original = String.raw`x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}`;
const revised = String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`;
async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data },
    recordVideo: { dir: output },
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => assert.equal(dialog.type(), "beforeunload"));
  await page.getByText("Make room for focus.", { exact: true }).waitFor();
}
async function open() {
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open canvas", exact: true }).click();
  await page.locator(".excalidraw canvas").first().waitFor();
}
async function save() {
  await page.getByRole("button", { name: "Save canvas", exact: true }).click();
  await page
    .locator(".canvas-header [role=status]")
    .getByText("Saved", { exact: true })
    .waitFor();
}
try {
  await launch();
  await page.evaluate(async () => {
    const state = await window.desk.command({
      type: "class.create",
      name: "Mathematics",
    });
    await window.desk.command({
      type: "task.create",
      input: {
        title: "Equation notes",
        classId: state.classes[0].id,
        dueAt: null,
        minutes: 30,
        deadlineConfirmed: true,
        resource: null,
        notes: "",
      },
    });
  });
  await open();
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await page.getByLabel("LaTeX equation").fill(String.raw`\notACommand{x}`);
  await page
    .getByRole("button", { name: "Insert equation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Math block" })
    .getByRole("alert")
    .waitFor();
  await page.getByLabel("LaTeX equation").fill(original);
  await page
    .getByRole("button", { name: "Insert equation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Math block" })
    .waitFor({ state: "hidden" });
  await save();
  const id = (await page.evaluate(() => window.desk.snapshot())).canvases[0].id;
  const first = await page.evaluate((id) => window.desk.canvas(id), id);
  const equation = first.scene.elements.find(
    (e) => !e.isDeleted && e.customData?.deskMath,
  );
  assert.equal(equation.customData.deskMath.latex, original);
  assert.ok(
    first.scene.files[equation.fileId].dataURL.startsWith(
      "data:image/png;base64,",
    ),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await save();
  assert.equal(
    (
      await page.evaluate((id) => window.desk.canvas(id), id)
    ).scene.elements.filter((e) => !e.isDeleted).length,
    0,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await save();
  assert.equal(
    (
      await page.evaluate((id) => window.desk.canvas(id), id)
    ).scene.elements.find((e) => !e.isDeleted).customData.deskMath.latex,
    original,
  );
  await page.screenshot({ path: join(output, "canvas-math.png") });
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  await app.close();
  await page.video().saveAs(join(output, "canvas-math-insert.webm"));
  await launch();
  await open();
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await page.getByLabel("Equation", { exact: true }).selectOption(equation.id);
  assert.equal(await page.getByLabel("LaTeX equation").inputValue(), original);
  await page.getByLabel("LaTeX equation").fill(revised);
  await page
    .getByRole("button", { name: "Update equation", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Math block" })
    .waitFor({ state: "hidden" });
  await save();
  const edited = await page.evaluate((id) => window.desk.canvas(id), id);
  const updated = edited.scene.elements.find((e) => e.id === equation.id);
  assert.equal(updated.customData.deskMath.latex, revised);
  assert.notEqual(updated.fileId, equation.fileId);
  assert.equal(updated.x, equation.x);
  assert.equal(updated.y, equation.y);
  await page.screenshot({ path: join(output, "canvas-math-edited.png") });
  const exported = join(data, "equation.png");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exported);
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  await page.getByText("PNG exported", { exact: true }).waitFor();
  const bytes = await readFile(exported);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await copyFile(exported, join(output, "canvas-math-export.png"));

  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  await app.close();
  await page.video().saveAs(join(output, "canvas-math-edit.webm"));
  await launch();
  assert.deepEqual(
    (await page.evaluate((id) => window.desk.canvas(id), id)).scene,
    edited.scene,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify({
      result: "PASS",
      flows: [
        "invalid LaTeX reports error",
        "insert rendered equation with source",
        "undo/redo",
        "restart and edit source",
        "edited image and source persist",
        "equation PNG export",
      ],
      limitations: [
        "not full math/Canvas acceptance",
        "native export dialog result injected; Windows and math keyboard undo not verified",
      ],
    }),
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
