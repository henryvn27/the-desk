// Interactive native-picker verification. Launch from the repo root, use the real
// Import text files dialog to select the printed synthetic path, then create
// artifacts/native-picker/finish.signal. No dialog stub or developer key is used.
import { _electron as electron } from "playwright";
import {
  mkdtemp,
  mkdir,
  writeFile,
  access,
  rm,
  copyFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data = await mkdtemp(join(tmpdir(), "desk-native-picker-"));
const output = resolve("artifacts/native-picker");
await mkdir(output, { recursive: true });
const signal = join(output, "finish.signal");
await rm(signal, { force: true });
const file = join(data, "native-physics-notes.md");
await writeFile(file, "Physics: Review momentum tomorrow\n");
let app;
try {
  app = await electron.launch({
    executablePath:
      process.env.DESK_EXECUTABLE ??
      "/Users/henry/Applications/The Desk V1.app/Contents/MacOS/The Desk V1",
    args: [],
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
    },
    recordVideo: { dir: output },
  });
  let page;
  await waitFor(
    () =>
      Boolean((page = app.windows().find((p) => p.url().endsWith("#main")))),
    "Main missing",
  );
  await page.evaluate(async () => {
    await window.desk.command({ type: "class.create", name: "Physics" });
    await window.desk.command({ type: "capture.policy", mode: "conservative" });
  });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  console.log(
    JSON.stringify({
      status: "ready-for-native-picker",
      file,
      pid: app.process().pid,
    }),
  );
  await waitFor(
    async () => {
      try {
        await access(signal);
        return true;
      } catch {
        return false;
      }
    },
    "Native interaction deadline expired",
    600000,
  );
  const snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.captureInbox.length, 1);
  assert.equal(
    snapshot.captureInbox[0].draft.provenance.sourceName,
    "native-physics-notes.md",
  );
  assert.equal(snapshot.captureInbox[0].draft.provenance.source, "text-file");
  assert.equal(snapshot.tasks.length, 0);
  await page.screenshot({ path: join(output, "native-picker-result.png") });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video)
    await copyFile(
      await video.path(),
      join(output, "native-picker-main-operated.webm"),
    );
  console.log(
    "PASS: real native macOS picker selection imported the synthetic file into isolated SQLite Inbox; no native-dialog stub used",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
