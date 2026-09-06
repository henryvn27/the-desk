import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-connections-ui-"));
const output = resolve("artifacts/connections");
await mkdir(output, { recursive: true });
let app;
let page;
const errors = [];

async function launch() {
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
  for (let attempt = 0; attempt < 100; attempt++) {
    page = app.windows().find((window) => window.url().endsWith("#main"));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(page, "Main Desk window opened");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

try {
  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Connections", exact: true }).waitFor();
  for (const name of [
    "Google Calendar",
    "Gmail",
    "Google Classroom",
    "Google Drive / Docs",
    "Khan Academy",
    "Quizlet",
    "Generic websites",
    "Gemini Notebook / NotebookLM",
  ]) {
    await page.getByRole("heading", { name, exact: true }).waitFor();
  }
  assert.equal(await page.getByText("Available now", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Not connected", { exact: true }).count(), 3);
  assert.equal(await page.getByText("Unavailable", { exact: true }).count(), 4);
  assert.equal(await page.getByText("Synced", { exact: true }).count(), 0);
  await page
    .getByRole("heading", { name: "Connections", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "connections.png") });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "connections-operated.webm"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: connection ladder exposes declared surfaces, current states, and manual fallbacks without fake sync.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
