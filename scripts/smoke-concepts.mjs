import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-concepts-ui-"));
const output = resolve("artifacts/concepts");
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
  await page.getByRole("button", { name: "Concepts", exact: true }).waitFor();
}

try {
  await launch();
  const ids = await page.evaluate(async () => {
    const createdClass = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const classId = createdClass.classes.at(-1).id;
    const createdTask = await window.desk.command({
      type: "task.create",
      input: {
        title: "Kinematics worksheet",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "Resolve components before calculating acceleration.",
        deadlineConfirmed: true,
      },
    });
    return { classId, taskId: createdTask.tasks.at(-1).id };
  });

  await page.getByRole("button", { name: "Concepts", exact: true }).click();
  await page
    .getByRole("heading", { name: "Concepts & preparedness", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Add concept", exact: true }).click();
  await page
    .getByLabel("Concept class", { exact: true })
    .selectOption(ids.classId);
  await page
    .getByLabel("Concept assignments", { exact: true })
    .selectOption(ids.taskId);
  await page.getByLabel("Concept name", { exact: true }).fill("Kinematics");
  await page
    .getByLabel("Concept status", { exact: true })
    .selectOption("learning");
  await page
    .getByLabel("Concept preparedness", { exact: true })
    .selectOption("not-ready");
  await page
    .getByLabel("Concept retention", { exact: true })
    .selectOption("long-term");
  await page.getByLabel("Concept attempts", { exact: true }).fill("3");
  await page.getByLabel("Unaided correct", { exact: true }).fill("1");
  await page.getByLabel("Unaided attempts", { exact: true }).fill("2");
  await page.getByLabel("Hint count", { exact: true }).fill("1");
  await page
    .getByLabel("Concept last reviewed", { exact: true })
    .fill("2026-09-05T08:00");
  await page
    .getByLabel("Concept evidence note", { exact: true })
    .fill("Can set up the model with a prompt.");
  await page.getByRole("button", { name: "Save concept", exact: true }).click();
  await page.getByText("Kinematics", { exact: true }).waitFor();

  let snapshot = await page.evaluate(() => window.desk.snapshot());
  let concept = snapshot.concepts[0];
  assert.equal(concept.classId, ids.classId);
  assert.deepEqual(concept.taskIds, [ids.taskId]);
  assert.equal(concept.preparedness, "not-ready");
  assert.equal(concept.retentionMode, "long-term");
  assert.equal(concept.attempts, 3);
  assert.equal(concept.unaidedCorrect, 1);
  assert.equal(concept.unaidedTotal, 2);
  assert.equal(concept.hintCount, 1);
  assert.equal(concept.revision, 0);

  await page.getByRole("button", { name: "Edit concept", exact: true }).click();
  await page
    .getByLabel("Concept preparedness", { exact: true })
    .selectOption("mostly-ready");
  await page
    .getByLabel("Concept status", { exact: true })
    .selectOption("developing");
  await page
    .getByLabel("Concept evidence note", { exact: true })
    .fill("Unaided setup is improving.");
  await page.getByRole("button", { name: "Save concept", exact: true }).click();
  await page.getByText("Unaided setup is improving.", { exact: true }).waitFor();

  snapshot = await page.evaluate(() => window.desk.snapshot());
  concept = snapshot.concepts[0];
  assert.equal(concept.revision, 1);
  assert.equal(concept.preparedness, "mostly-ready");
  assert.equal(concept.status, "developing");
  assert.equal(concept.evidenceNote, "Unaided setup is improving.");
  await page.screenshot({ path: join(output, "concepts.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "concepts-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Concepts", exact: true }).click();
  await page.getByText("Unaided setup is improving.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.concepts.length, 1);
  assert.equal(snapshot.tasks.length, 1);
  await page
    .getByRole("button", { name: "Forget concept", exact: true })
    .click();
  await page.getByText("No concepts recorded yet.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.concepts.length, 0);
  assert.equal(snapshot.tasks.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Concepts UI records explicit preparedness evidence, edits by revision, persists across restart, and forgets only the concept.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
