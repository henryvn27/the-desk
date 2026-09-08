import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-notes-"));
const output = resolve("artifacts/notes");
await mkdir(output, { recursive: true });
const onePixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let app;
let page;
try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0" },
    recordVideo: { dir: output },
  });
  page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  // Electron can emit a transient beforeunload event while the Notes modal
  // flushes its last revision. Leave that protocol event untouched; the app
  // owns the save-and-close path.
  page.on("dialog", (dialog) => assert.equal(dialog.type(), "beforeunload"));
  await page.evaluate(async () => {
    const created = await window.desk.command({ type: "class.create", name: "Calculus" });
    await window.desk.command({
      type: "task.create",
      input: { title: "Limits lecture", classId: created.classes[0].id, dueAt: null, minutes: 45, deadlineConfirmed: false, resource: null, notes: "" },
    });
  });
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Open Notes", exact: true }).click();
  await page.getByRole("dialog", { name: "Study notes" }).waitFor();

  const first = page.getByPlaceholder("Start writing, or type / for a block…").first();
  await first.fill("# Limits");
  await page.getByRole("textbox", { name: "Heading" }).waitFor();
  await page.getByRole("textbox", { name: "Heading" }).press("Enter");
  const paragraph = page.getByPlaceholder("Start writing, or type / for a block…").last();
  await paragraph.fill("A calculus lecture with inline $F=ma$ and a worked example.");
  await page.getByRole("button", { name: "＋ Block", exact: true }).click();
  const slashTarget = page.getByPlaceholder("Start writing, or type / for a block…").last();
  await slashTarget.fill("/");
  await page.getByRole("menu", { name: "Insert block" }).getByRole("button", { name: "Math", exact: true }).click();
  const mathBlock = page.locator(".note-math").last();
  await mathBlock.locator("textarea").nth(1).fill("m = 5 kg\na = 3 m/s^2\nF = ma");
  await page.getByText(/15 N/).waitFor();
  await page.getByRole("button", { name: "＋ Block", exact: true }).click();
  const graphTarget = page.getByPlaceholder("Start writing, or type / for a block…").last();
  await graphTarget.fill("/");
  await page.getByRole("menu", { name: "Insert block" }).getByRole("button", { name: "Graph", exact: true }).click();
  const graphBlock = page.locator(".note-graph").last();
  await graphBlock.getByLabel("Graph expression 1", { exact: true }).fill("x^2");
  await graphBlock.locator("select").first().selectOption({ index: 1 });
  const graphPathBefore = await graphBlock.locator("path").first().getAttribute("d");
  await mathBlock.locator("textarea").nth(1).fill("m = 5 kg\na = 4 m/s^2\nF = ma");
  await page.waitForFunction((before) => document.querySelector(".note-graph path")?.getAttribute("d") !== before, graphPathBefore);
  await page.getByRole("button", { name: "＋ Data", exact: true }).click();
  const dataBlock = page.locator(".note-table:has(.note-data-controls)").last();
  await dataBlock.getByRole("button", { name: "＋ Calculated column", exact: true }).click();
  await dataBlock.getByLabel("Formula for Calculated 1", { exact: true }).fill("x * 2");
  await dataBlock.locator(".calculated-cell").first().waitFor();
  assert.equal(await dataBlock.locator(".calculated-cell").first().innerText(), "2");
  await dataBlock.locator(".note-data-controls select").first().selectOption("regression");
  await dataBlock.getByRole("img", { name: "Regression plot" }).waitFor();
  await dataBlock.getByRole("button", { name: "＋ Row", exact: true }).click();

  const paperInput = page.locator(".notes-import input[type=file]").first();
  await paperInput.setInputFiles({ name: "physics-paper.png", mimeType: "image/png", buffer: onePixel });
  await page.getByText("Paper capture inserted", { exact: true }).waitFor();
  const media = page.locator(".note-media").last();
  await media.getByText("Semantic layer", { exact: true }).click();
  await media.locator("details textarea").first().fill("friction coefficient and free body diagram\nF = ma");
  await media.getByRole("button", { name: "Recognize math", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll(".note-media details textarea")][3]?.value.includes("F = ma"));
  await media.getByRole("button", { name: "Save semantic layer as source", exact: true }).click();
  await page.getByText("Paper semantic layer linked to Sources.", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "notes-flow.png") });
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();

  const canvasId = await page.evaluate(async () => (await window.desk.snapshot()).canvases[0].id);
  const recording = await page.evaluate(async (id) => {
    const started = await window.desk.recordingStart(id, "audio/webm");
    await window.desk.recordingChunk(started.recordingId, 0, new Uint8Array([1, 2, 3]));
    const finished = await window.desk.recordingFinish(started.recordingId);
    const current = await window.desk.canvas(id);
    const recordings = [...(current.scene.document?.recordings ?? []), { id: started.recordingId, status: "complete", startedAt: started.startedAt, endedAt: finished.endedAt, durationMs: 1000, chunkCount: finished.chunkCount, mimeType: started.mimeType, events: [{ id: "marker-1", atMs: 500, blockId: current.scene.document?.blocks[0]?.id, label: "Heading" }] }];
    await window.desk.command({ type: "canvas.save", id, revision: current.revision, scene: { ...current.scene, document: { ...(current.scene.document ?? { version: 1, blocks: [] }), recordings } } });
    return started.recordingId;
  }, canvasId);
  assert.ok(recording);
  const saved = await page.evaluate((id) => window.desk.canvas(id), canvasId);
  assert.equal(saved.scene.document.recordings[0].chunkCount, 1);
  assert.equal(saved.scene.document.captures[0].sourceId !== undefined, true);
  await page.getByRole("button", { name: "Close notes", exact: true }).click();

  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.locator("#search").fill("friction coefficient");
  const result = page.locator(".search-result").filter({ hasText: "NOTE" }).filter({ hasText: "friction coefficient" });
  await result.waitFor();
  await result.click();
  await page.getByRole("dialog", { name: "Study notes" }).waitFor();
  await page.getByRole("button", { name: "Play lecture at 1s", exact: true }).waitFor();
  await page.locator(".note-block.is-active.note-image, .note-block.is-active.note-file").waitFor();
  await page.screenshot({ path: join(output, "notes-deep-link.png") });
  console.log(JSON.stringify({ result: "PASS", flows: ["keyboard document flow", "Markdown heading and inline math", "semantic unit-aware math", "linked live graph", "calculated columns and regression data plot", "paper original plus semantic layer and Sources link", "durable recording chunks and note marker", "unified search deep-link"] }));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
