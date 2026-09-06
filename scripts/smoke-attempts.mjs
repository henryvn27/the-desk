import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-attempts-ui-"));
const output = resolve("artifacts/attempts");
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
  await page.getByRole("button", { name: "Attempts", exact: true }).waitFor();
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
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const taskId = createdTask.tasks.at(-1).id;
    const createdConcept = await window.desk.command({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskId],
        name: "Acceleration",
        status: "learning",
        preparedness: "developing",
        retentionMode: "course",
        reviewDue: null,
        attempts: 0,
        unaidedCorrect: 0,
        unaidedTotal: 0,
        hintCount: 0,
        lastReviewedAt: null,
        evidenceNote: "",
      },
    });
    return { classId, taskId, conceptId: createdConcept.concepts.at(-1).id };
  });

  await page.getByRole("button", { name: "Attempts", exact: true }).click();
  await page.getByRole("heading", { name: "Attempts", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Record attempt", exact: true })
    .click();
  await page
    .getByLabel("Attempt class", { exact: true })
    .selectOption(ids.classId);
  await page
    .getByLabel("Attempt assignment", { exact: true })
    .selectOption(ids.taskId);
  await page
    .getByLabel("Attempt concepts", { exact: true })
    .selectOption(ids.conceptId);
  await page
    .getByLabel("Attempt result", { exact: true })
    .selectOption("correct");
  await page.getByLabel("Attempt hint count", { exact: true }).fill("0");
  await page
    .getByLabel("Attempt notes", { exact: true })
    .fill("Set up the equation independently.");
  await page
    .getByLabel("Attempted at", { exact: true })
    .fill("2026-09-05T08:00");
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await page
    .getByText("Set up the equation independently.", { exact: true })
    .waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  let attempt = snapshot.attempts[0];
  assert.equal(attempt.result, "correct");
  assert.equal(attempt.unaided, true);
  assert.equal(snapshot.concepts[0].attempts, 1);
  assert.equal(snapshot.concepts[0].unaidedCorrect, 1);
  assert.equal(snapshot.concepts[0].unaidedTotal, 1);

  await page.getByRole("button", { name: "Edit attempt", exact: true }).click();
  await page
    .getByLabel("Attempt result", { exact: true })
    .selectOption("incorrect");
  await page.getByLabel("Attempt unaided", { exact: true }).uncheck();
  await page.getByLabel("Attempt hint count", { exact: true }).fill("2");
  await page
    .getByLabel("Attempt notes", { exact: true })
    .fill("Needed a hint to choose the sign.");
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await page
    .getByText("Needed a hint to choose the sign.", { exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  attempt = snapshot.attempts[0];
  assert.equal(attempt.revision, 1);
  assert.equal(attempt.result, "incorrect");
  assert.equal(attempt.unaided, false);
  assert.equal(attempt.hintCount, 2);
  assert.equal(snapshot.concepts[0].attempts, 1);
  assert.equal(snapshot.concepts[0].unaidedCorrect, 0);
  assert.equal(snapshot.concepts[0].unaidedTotal, 0);
  assert.equal(snapshot.concepts[0].hintCount, 2);
  await page.screenshot({ path: join(output, "attempts.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "attempts-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Attempts", exact: true }).click();
  await page
    .getByText("Needed a hint to choose the sign.", { exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.attempts.length, 1);
  await page
    .getByRole("button", { name: "Forget attempt", exact: true })
    .click();
  await page.getByText("No attempts recorded yet.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.attempts.length, 0);
  assert.equal(snapshot.concepts[0].attempts, 0);
  assert.equal(snapshot.tasks.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Attempts UI records explicit results, updates linked concept evidence, edits by revision, persists across restart, and forgets only the attempt.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
