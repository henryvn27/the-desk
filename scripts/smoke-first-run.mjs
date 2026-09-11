import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-first-run-"));
const output = resolve("artifacts/first-run");
await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0" },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.desk.snapshot())).classes.length, 0);
  await page.screenshot({ path: join(output, "first-run-home.png") });

  await page.getByLabel("Ask The Desk", { exact: true }).fill("I need to write something down");
  await page.getByLabel("Ask The Desk", { exact: true }).press("Meta+Enter");
  await page.getByText("Opening a blank Note.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByRole("dialog", { name: "Study notes" }).waitFor();
  await page.getByPlaceholder("Start writing, or type / for a block…").first().fill("A first-run note needs no class.");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  const note = (await page.evaluate(async () => (await window.desk.snapshot()).canvases)).find((item) => item.taskId === null);
  assert.ok(note, "Chat can create an unassigned Note");
  await page.screenshot({ path: join(output, "unassigned-note.png") });
  await page.getByRole("button", { name: "Close notes", exact: true }).click();
  await page.keyboard.press("Meta+Shift+N");
  await page.getByRole("dialog", { name: "Study notes" }).waitFor();
  await page.getByRole("button", { name: "Close notes", exact: true }).click();

  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("heading", { name: "Quick capture", exact: true }).waitFor();
  await page.locator(".capture-dialog textarea").first().fill("Remember to read the friction chapter.");
  await page.getByRole("button", { name: "Capture now", exact: true }).click();
  await page.getByText(/Capture saved:/).waitFor();
  assert.equal((await page.evaluate(() => window.desk.snapshot())).captureInbox.length, 1);

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Save text source", exact: true }).click();
  await page.getByRole("heading", { name: "Save a source", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Source title", exact: true }).fill("A source before setup");
  await page.getByRole("textbox", { name: "Original text", exact: true }).fill("Friction opposes relative motion.");
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  assert.equal((await page.evaluate(() => window.desk.snapshot())).sources.length, 1);

  await page.evaluate(() => window.desk.lens());
  const lens = await app.waitForEvent("window", { timeout: 10_000 });
  await lens.locator(".lens.lens-typed-selecting").waitFor();
  assert.equal(await lens.locator(".lens-input-popover").count(), 0, "Lens starts selection without setup");
  await lens.evaluate(() => window.desk.dismiss());

  console.log(JSON.stringify({ result: "PASS", flows: ["Chat → unassigned Note", "zero-class Capture Inbox", "unassigned Source", "Lens selection without setup"] }));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
