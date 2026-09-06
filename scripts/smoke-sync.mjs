import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-sync-ui-"));
const output = resolve("artifacts/sync");
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
  const snapshot = await page.evaluate(() =>
    window.desk.command({ type: "class.create", name: "Physics" }),
  );
  const course = snapshot.classes[0];
  assert.ok(course);
  const operationId = snapshot.outbox.at(-1)?.id;
  assert.ok(operationId);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const heading = page.getByRole("heading", {
    name: "Local sync boundary",
    exact: true,
  });
  await heading.waitFor();
  await page
    .getByText("1 local operation waiting for a future sync.", { exact: true })
    .waitFor();
  await page.getByText("Cloud sync: not connected", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Retry queued operations", exact: true }).click();
  await page.waitForFunction(
    async (id) =>
      (await window.desk.snapshot()).outbox.find(
        (operation) => operation.id === id,
      )?.attempts === 1,
    operationId,
  );
  await page.evaluate(
    ({ course, operationId }) =>
      window.desk.command({
        type: "sync.conflict.record",
        input: {
          entityId: course.id,
          operationId,
          operation: "class.create",
          localData: JSON.stringify(course),
          remoteData: JSON.stringify({ ...course, name: "Physics (school)" }),
        },
      }),
    { course, operationId },
  );
  await page.getByRole("heading", { name: "Preserved conflicts", exact: true }).waitFor();
  await page.getByText("Needs review", { exact: true }).waitFor();
  await page.getByText("View preserved local and remote copies", { exact: true }).click();
  await page.getByText(/Physics \(school\)/).waitFor();
  await heading.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "sync.png") });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "sync-operated.webm"));

  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByText("No local operations are waiting.", { exact: true })
    .waitFor();
  await page.getByText("Needs review", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Keep local copy", exact: true }).click();
  await page.getByText("keep-local", { exact: true }).waitFor();
  const restarted = await page.evaluate(() => window.desk.snapshot());
  assert.equal(restarted.outbox.at(-1)?.id, operationId);
  assert.equal(restarted.outbox.at(-1)?.status, "queued");
  assert.equal(restarted.outbox.at(-1)?.attempts, 2);
  assert.equal(restarted.classes[0]?.name, "Physics");
  assert.equal(restarted.syncConflicts[0]?.localData, JSON.stringify(course));
  assert.equal(
    JSON.parse(restarted.syncConflicts[0]?.remoteData ?? "{}").name,
    "Physics (school)",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local outbox intent, retry state and preserved sync conflict survive restart without fake cloud sync.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
