import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-recording-permission-"));
const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];
if (!process.env.DESK_EXECUTABLE) args.push(".");
let app;
try {
  app = await electron.launch({
    args,
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_TEST_BACKGROUND: "1", DESK_ENABLE_DEVELOPMENT_KEY: "0" },
  });
  const page = await app.firstWindow();
  page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => {}); });
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByRole("heading", { name: "Notes", exact: true }).waitFor();
  await page.getByRole("button", { name: "New note", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Study notes" });
  await dialog.waitFor();

  await dialog.getByRole("button", { name: "Record lecture", exact: true }).click();
  await dialog.getByRole("button", { name: "Stop recording", exact: true }).waitFor({ timeout: 10_000 });
  assert.match(await dialog.locator(".recording-status").innerText(), /Recording/);
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  await dialog.getByRole("button", { name: "Stop recording", exact: true }).click();
  await dialog.getByText("Recording saved in timestamped chunks.", { exact: true }).waitFor({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Save notes", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: "Saved" }).waitFor({ timeout: 10_000 });

  const result = await page.evaluate(async () => {
    const snapshot = await window.desk.snapshot();
    const summary = snapshot.canvases[0];
    if (!summary) return null;
    const canvas = await window.desk.canvas(summary.id);
    return canvas.scene.document?.recordings?.at(-1) ?? null;
  });
  assert.equal(result?.status, "complete");
  assert.ok((result?.chunkCount ?? 0) > 0, "fake audio produced a durable chunk");
  console.log(JSON.stringify({ result: "PASS", status: result.status, chunkCount: result.chunkCount }));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
