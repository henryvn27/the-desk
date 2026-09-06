import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-assessments-ui-"));
const output = resolve("artifacts/assessments");
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
  await page
    .getByRole("button", { name: "Assessments", exact: true })
    .waitFor();
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
        title: "Kinematics review",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const taskId = createdTask.tasks.at(-1).id;
    const category = await window.desk.command({
      type: "grade.category",
      input: { classId, name: "Tests", weight: 50 },
    });
    return {
      classId,
      taskId,
      categoryId: category.gradeCategories.at(-1).id,
    };
  });

  await page.getByRole("button", { name: "Assessments", exact: true }).click();
  await page
    .getByRole("heading", { name: "Assessments", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add assessment", exact: true })
    .click();
  await page
    .getByLabel("Assessment class", { exact: true })
    .selectOption(ids.classId);
  await page
    .getByLabel("Assessment title", { exact: true })
    .fill("Kinematics test");
  await page
    .getByLabel("Assessment type", { exact: true })
    .selectOption("test");
  await page
    .getByLabel("Assessment tasks", { exact: true })
    .selectOption(ids.taskId);
  await page
    .getByLabel("Assessment due", { exact: true })
    .fill("2026-09-08T09:00");
  await page
    .getByLabel("Assessment grade category", { exact: true })
    .selectOption(ids.categoryId);
  await page
    .getByLabel("Assessment notes", { exact: true })
    .fill("Bring the formula sheet.");
  await page
    .getByRole("button", { name: "Save assessment", exact: true })
    .click();
  await page.getByText("Kinematics test", { exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  let assessment = snapshot.assessments[0];
  assert.equal(assessment.kind, "test");
  assert.deepEqual(assessment.taskIds, [ids.taskId]);
  assert.equal(assessment.gradeCategoryId, ids.categoryId);

  await page
    .getByRole("button", { name: "Edit assessment", exact: true })
    .click();
  await page
    .getByLabel("Assessment type", { exact: true })
    .selectOption("midterm");
  await page
    .getByLabel("Assessment notes", { exact: true })
    .fill("Updated scope.");
  await page
    .getByRole("button", { name: "Save assessment", exact: true })
    .click();
  await page.getByText("Updated scope.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assessment = snapshot.assessments[0];
  assert.equal(assessment.revision, 1);
  assert.equal(assessment.kind, "midterm");
  await page.screenshot({ path: join(output, "assessments.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "assessments-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Assessments", exact: true }).click();
  await page.getByText("Updated scope.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.assessments.length, 1);
  await page
    .getByRole("button", { name: "Forget assessment", exact: true })
    .click();
  await page
    .getByText("No assessments recorded yet.", { exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.assessments.length, 0);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.gradeCategories.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Assessments record first-class type and links, update by revision, persist across restart, and forget without deleting tasks or grade context.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
