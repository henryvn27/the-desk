import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data = await mkdtemp(join(tmpdir(), "desk-file-ui-"));
const output = resolve("artifacts/text-import");
await mkdir(output, { recursive: true });
const good = join(data, "physics-notes.md");
const other = join(data, "reading.txt");
const bad = join(data, "unsupported.pdf");
await writeFile(good, "- Physics: Review momentum tomorrow\n- Physics: Complete practice questions");
await writeFile(other, "Read chapter 3");
await writeFile(bad, "%PDF synthetic unsupported fixture");
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: process.env.DESK_EXECUTABLE ? [] : ["."], executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0", TZ: "UTC" }, recordVideo: { dir: output } });
  await waitFor(() => Boolean(page = app.windows().find(p => p.url().endsWith("#main"))), "Main window did not open");
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("button", { name: "Capture", exact: true }).waitFor();
}
const snap = () => page.evaluate(() => window.desk.snapshot());
async function picker(paths, canceled = false) {
  await app.evaluate(({dialog}, value) => {
    dialog.showOpenDialog = async (_window, options) => {
      if (options.title !== "Import academic text") throw Error("Unexpected picker");
      return { canceled: value.canceled, filePaths: value.paths };
    };
  }, { paths, canceled });
}
try {
  await launch();
  await page.getByLabel("Class name", { exact: true }).fill("Physics");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).waitFor();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await picker([], true);
  await page.getByRole("button", { name: "Import text files", exact: true }).click();
  await waitFor(async () => await page.getByRole("button", { name: "Import text files", exact: true }).isEnabled(), "Canceled picker did not return");
  assert.equal((await snap()).captureInbox.length, 0);
  await picker([good, bad]);
  await page.getByRole("button", { name: "Import text files", exact: true }).click();
  await page.getByText("Import supports visible .txt and .md files only.", { exact: true }).waitFor();
  assert.equal((await snap()).captureInbox.length, 0);
  await picker([good, other]);
  await page.getByRole("button", { name: "Import text files", exact: true }).click();
  await page.getByRole("button", { name: "Pending (3)", exact: true }).waitFor();
  let state = await snap();
  assert.equal(state.tasks.length, 0);
  assert.equal(state.captureInbox[0].draft.provenance.sourceName, "physics-notes.md");
  assert.equal(state.captureInbox[2].draft.provenance.sourceName, "reading.txt");
  assert.equal(JSON.stringify(state.captureInbox).includes(data), false);
  await page.locator("article").first().getByText("Source text", { exact: true }).click();
  await page.screenshot({ path: join(output, "imported-text.png") });
  await page.locator("article").first().getByRole("button", { name: "Review capture", exact: true }).click();
  await page.getByLabel("Due date", { exact: true }).fill("");
  await page.getByLabel("I have confirmed").check();
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.getByRole("button", { name: "Pending (2)", exact: true }).waitFor();
  state = await snap();
  assert.equal(state.tasks[0].captureEvidence.sourceName, "physics-notes.md");
  assert.equal(state.tasks[0].captureEvidence.source, "text-file");
  await page.evaluate(() => window.desk.lens());
  let lens;
  await waitFor(() => Boolean(lens = app.windows().find(p => p.url().endsWith("#lens"))), "Lens did not open");
  assert.equal(await lens.evaluate(async () => {
    try { await window.desk.importCaptureFiles(); return false; } catch { return true; }
  }), true);
  await lens.getByRole("button", { name: "Dismiss · Esc", exact: true }).click();
  const video = page.video();
  await app.close(); app = undefined;
  if (video) await copyFile(await video.path(), join(output, "text-import-operated.webm"));
  await launch();
  assert.deepEqual((await snap()).captureInbox, state.captureInbox);
  assert.deepEqual((await snap()).tasks, state.tasks);
  assert.deepEqual(errors, []);
  console.log("PASS: native text-file batch, cancellation, mixed invalid batch rollback, basename/source preservation, reviewed assignment, Lens import denial and restart");
} finally { if (app) await app.close(); await rm(data, { recursive: true, force: true }); }
