import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
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
  await page.getByRole("button", { name: "Close canvas", exact: true }).click();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  const id = snapshot.canvases[0].id;
  const before = await page.evaluate((id) => window.desk.canvas(id), id);
  assert.equal(before.scene.elements.filter((e) => !e.isDeleted).length, 3);
  assert.ok(
    before.scene.elements.some(
      (e) => e.type === "freedraw" && e.points.length > 10,
    ),
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
  console.log(
    JSON.stringify({
      result: "PASS",
      flows: [
        "ink",
        "arrow",
        "rectangle",
        "undo/redo",
        "flush on close",
        "exact scene across restart",
      ],
      limitations: [
        "not complete Canvas acceptance",
        "export/PDF/math/Windows not tested",
      ],
    }),
  );
  assert.equal(errors.length, 0, errors.join("\n"));
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
