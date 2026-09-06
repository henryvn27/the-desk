import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data = await mkdtemp(join(tmpdir(), "desk-policy-ui-"));
const output = resolve("artifacts/capture-policy");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: process.env.DESK_EXECUTABLE ? [] : ["."], executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0", TZ: "UTC" }, recordVideo: { dir: output } });
  await waitFor(() => Boolean(page = app.windows().find(p => p.url().endsWith("#main"))), "Main window did not open");
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}
const snap = () => page.evaluate(() => window.desk.snapshot());
async function capture(text) {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByLabel("Paste an assignment or a few clear assignment lines").fill(text);
  await page.getByRole("button", { name: "Interpret text", exact: true }).click();
  await page.getByRole("heading", { name: "Capture Inbox", exact: true }).waitFor();
}
async function mode(value) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Capture mode", { exact: true }).selectOption(value);
  await waitFor(async () => (await snap()).capturePolicy === value, "Capture policy did not persist");
}
try {
  await launch();
  await page.getByLabel("Class name", { exact: true }).fill("English 12");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "English 12", exact: true }).waitFor();
  const due = new Date(Date.now() + 3 * 86400000).toISOString();
  const complete = `English 12: Read chapter 3 due ${due}, 30 minutes`;
  await capture(`${complete}\nEnglish 12: Essay due tomorrow`);
  let state = await snap();
  assert.equal(state.tasks.length, 1);
  assert.equal(state.captureInbox.filter(i => i.status === "pending").length, 1);
  await page.getByRole("button", { name: "Filed (1)", exact: true }).click();
  await page.getByText("Complete high-confidence text with an explicit timestamp met your capture policy.", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "capture-filed.png") });
  await page.getByRole("button", { name: "Undo filing", exact: true }).click();
  await page.getByRole("button", { name: "Pending (2)", exact: true }).waitFor();
  assert.equal((await snap()).tasks.length, 0);
  await mode("conservative");
  await capture(complete);
  assert.equal((await snap()).tasks.length, 0);
  await mode("autopilot");
  await page.getByLabel("Capture mode", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "capture-policy-settings.png") });
  assert.equal((await snap()).tasks.length, 0);
  await capture(`English: Read chapter 4 due ${due}, 30 minutes`);
  state = await snap();
  assert.equal(state.tasks.length, 1);
  assert.equal(state.captureInbox.at(-1).draft.confidence.classId, "medium");
  assert.equal(state.captureInbox.at(-1).filing.policy, "autopilot");
  const video = page.video();
  await app.close(); app = undefined;
  if (video) await copyFile(await video.path(), join(output, "capture-policy-operated.webm"));
  await launch();
  assert.deepEqual((await snap()).captureInbox, state.captureInbox);
  assert.equal((await snap()).capturePolicy, "autopilot");
  assert.deepEqual((await snap()).tasks, state.tasks);
  assert.deepEqual(errors, []);
  console.log("PASS: Balanced automatic filing and visible reason, uncertainty review, filing undo, Conservative review, Autopilot unique partial match, no retroactive filing, mode and history restart persistence");
} finally { if (app) await app.close(); await rm(data, { recursive: true, force: true }); }
