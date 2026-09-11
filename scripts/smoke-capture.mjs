import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-capture-"));
const output = resolve("artifacts/capture");
await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
      TZ: "UTC",
    },
    recordVideo: { dir: output },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  await page.evaluate(async () => {
    await window.desk.command({ type: "class.create", name: "AP Physics C" });
  });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+Shift+Space`);
  await page.getByRole("heading", { name: "Quick capture", exact: true }).waitFor();
  await page
    .getByLabel("Paste a capture or a few clear assignment lines", { exact: true })
    .fill("AP Physics C: Problem Set 4 due 2026-09-08T22:00:00Z, 45 minutes");
  await page.screenshot({ path: join(output, "capture-quick.png") });
  await page.keyboard.press(`${modifier}+Enter`);
  await page.getByRole("heading", { name: "Capture Inbox", exact: true }).waitFor();
  const state = await page.evaluate(() => window.desk.snapshot());
  assert.equal(state.tasks.length, 1);
  assert.equal(state.captureInbox.at(-1).status, "accepted");
  assert.equal(
    state.tasks.at(-1).captureEvidence.originalText,
    "AP Physics C: Problem Set 4 due 2026-09-08T22:00:00Z, 45 minutes",
  );
  await page.screenshot({ path: join(output, "capture-quick-saved.png") });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "capture-quick-operated.webm"));
  console.log("PASS: global shortcut, immediate durable capture, Inbox navigation, original-text recovery");
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
