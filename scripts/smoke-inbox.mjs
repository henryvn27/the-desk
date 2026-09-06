import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data = await mkdtemp(join(tmpdir(), "desk-inbox-ui-"));
const output = resolve("artifacts/inbox");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: process.env.DESK_EXECUTABLE ? [] : ["."], executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0", TZ: "UTC" }, recordVideo: { dir: output } });
  await waitFor(() => Boolean(page = app.windows().find(p => p.url().endsWith("#main"))), "Main window did not open");
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("button", { name: "Capture Inbox", exact: true }).waitFor();
}
const snap = () => page.evaluate(() => window.desk.snapshot());
try {
  await launch();
  await page.getByLabel("Class name", { exact: true }).fill("Physics");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).waitFor();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const original = "- Physics: Forces due tomorrow\n- Read chapter 3";
  await page.getByLabel("Paste an assignment or a few clear assignment lines").fill(original);
  await page.getByRole("button", { name: "Interpret text", exact: true }).click();
  await page.getByRole("heading", { name: "Capture Inbox", exact: true }).waitFor();
  assert.equal((await snap()).tasks.length, 0);
  assert.equal((await snap()).studyBlocks.length, 0);
  await page.locator("article").first().getByText("Source text", { exact: true }).click();
  await page.screenshot({ path: join(output, "capture-inbox.png") });
  const initial = await snap();
  const video = page.video();
  await app.close(); app = undefined;
  if (video) await copyFile(await video.path(), join(output, "capture-inbox-operated.webm"));
  await launch();
  assert.deepEqual((await snap()).captureInbox, initial.captureInbox);
  await page.getByRole("button", { name: "Capture Inbox", exact: true }).click();
  const second = page.locator("article").nth(1);
  await second.getByRole("button", { name: "Archive capture", exact: true }).click();
  await page.getByRole("button", { name: "Archived (1)", exact: true }).click();
  await page.getByRole("button", { name: "Restore capture", exact: true }).click();
  await page.getByRole("button", { name: "Pending (2)", exact: true }).click();
  await page.locator("article").first().getByRole("button", { name: "Review capture", exact: true }).click();
  await page.getByLabel("What needs doing?", { exact: true }).fill("Forces practice");
  await page.getByLabel("Due date", { exact: true }).fill("");
  await page.getByLabel("I have confirmed").check();
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.getByRole("button", { name: "Pending (1)", exact: true }).waitFor();
  let state = await snap();
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].captureEvidence.originalText, original);
  assert.equal(state.captureInbox[0].status, "accepted");
  await page.getByRole("button", { name: "Undo capture", exact: true }).click();
  await page.getByRole("button", { name: "Pending (2)", exact: true }).waitFor();
  assert.equal((await snap()).tasks.length, 0);
  // Keep a stale editor open while another owned client updates the item.
  await page.locator("article").first().getByRole("button", { name: "Review capture", exact: true }).click();
  await page.evaluate(async () => {
    const item = (await window.desk.snapshot()).captureInbox[0];
    await window.desk.command({ type: "inbox.archive", id: item.id, revision: item.revision, archived: true });
  });
  await page.getByLabel("Due date", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.getByText("This capture changed. Reopen the inbox and try again.", { exact: true }).waitFor();
  assert.equal((await snap()).tasks.length, 0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  state = await snap();
  const reviewVideo = page.video();
  await app.close(); app = undefined;
  if (reviewVideo) await copyFile(await reviewVideo.path(), join(output, "capture-inbox-review-operated.webm"));
  await launch();
  assert.deepEqual((await snap()).captureInbox, state.captureInbox);
  assert.deepEqual(errors, []);
  console.log("PASS: batch capture, durable uncertainty/source, no premature planning, archive/restore, reviewed task, undo to inbox, stale review rejection and restart");
} finally { if (app) await app.close(); await rm(data, { recursive: true, force: true }); }
