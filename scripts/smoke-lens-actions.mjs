import { _electron as electron } from "playwright";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";

const data = await mkdtemp(join(tmpdir(), "desk-lens-actions-"));
const output = resolve("artifacts/lens-actions");
await mkdir(output, { recursive: true });
const keyFile = join(data, "synthetic-key.txt");
await writeFile(keyFile, `sk-or-v1-${"test-only-".repeat(8)}`, { mode: 0o600 });

let app;
let page;
let lens;
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
  await waitFor(
    () => Boolean((page = app.windows().find((p) => p.url().endsWith("#main")))),
    "Main Desk window missing",
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

try {
  await launch();
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    globalThis.lensRequests = [];
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      globalThis.lensRequests.push({ url: String(url), model: body.model });
      return new Response(
        JSON.stringify({
          model: body.model,
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  explanation:
                    "Synthetic Lens answer: resolve the forces, then check the sign of each component.",
                  overlays: [],
                }),
              },
            },
          ],
        }),
      );
    };
  }, keyFile);
  await page.evaluate(() => window.desk.importProviderKey());
  await page.evaluate(async () => {
    await window.desk.command({ type: "class.create", name: "Physics" });
    const course = (await window.desk.snapshot()).classes[0];
    await window.desk.command({
      type: "task.create",
      input: {
        title: "Review force balance",
        classId: course.id,
        dueAt: null,
        minutes: 20,
        resource: "https://example.edu/force-balance",
        notes: "",
        deadlineConfirmed: false,
      },
    });
    const task = (await window.desk.snapshot()).tasks[0];
    await window.desk.command({ type: "session.start", taskId: task.id });
  });

  await page.evaluate(() => window.desk.lens());
  await waitFor(
    () => Boolean((lens = app.windows().find((p) => p.url().endsWith("#lens")))),
    "Lens window missing",
  );
  lens.on("pageerror", (error) => errors.push(error.message));
  await lens.getByLabel("Tutoring mode", { exact: true }).waitFor();
  await lens.getByText("Review force balance", { exact: true }).waitFor();
  await lens
    .getByLabel("Ask The Desk", { exact: true })
    .fill("How should I begin?");
  await lens.getByRole("button", { name: "Ask", exact: true }).click();
  await lens
    .getByText(
      "Synthetic Lens answer: resolve the forces, then check the sign of each component.",
      { exact: true },
    )
    .waitFor();

  await lens
    .getByRole("button", { name: "Save answer as source", exact: true })
    .click();
  await lens.getByText("Lens answer saved as a source.", { exact: true }).waitFor();
  await app.evaluate(({ shell }) => {
    globalThis.openedResources = [];
    shell.openExternal = async (url) => {
      globalThis.openedResources.push(String(url));
    };
  });
  await lens
    .getByRole("button", { name: "Open task resource", exact: true })
    .click();
  const snapshot = await page.evaluate(() => window.desk.snapshot());
  const source = snapshot.sources.at(-1);
  const task = snapshot.tasks[0];
  const [requests, openedResources] = await app.evaluate(() => [
    globalThis.lensRequests,
    globalThis.openedResources,
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.ok(source);
  assert.equal(source.title, "Lens answer");
  assert.equal(source.text, "Synthetic Lens answer: resolve the forces, then check the sign of each component.");
  assert.deepEqual(source.classIds, [task.classId]);
  assert.deepEqual(source.taskIds, [task.id]);
  assert.deepEqual(openedResources, ["https://example.edu/force-balance"]);
  await lens.locator(".lens-panel").screenshot({
    path: join(output, "lens-actions.png"),
  });
  const video = lens.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "lens-actions-operated.webm"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: synthetic Lens response exposes explicit linked-source and HTTPS resource actions; source links persist to the active class/task; no provider or arbitrary action is inferred.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
