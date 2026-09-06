import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-teachers-ui-"));
const output = resolve("artifacts/teachers");
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
  await page.getByRole("button", { name: "Teachers", exact: true }).waitFor();
}

try {
  await launch();
  const ids = await page.evaluate(async () => {
    const physics = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const history = await window.desk.command({
      type: "class.create",
      name: "World History",
    });
    const classId = physics.classes.at(-1).id;
    const historyId = history.classes.at(-1).id;
    const task = await window.desk.command({
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
    return { classId, historyId, taskId: task.tasks.at(-1).id };
  });

  await page.getByRole("button", { name: "Teachers", exact: true }).click();
  await page.getByRole("heading", { name: "Teachers", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add teacher", exact: true }).click();
  await page.getByLabel("Teacher name", { exact: true }).fill("Dr. Rivera");
  await page
    .getByLabel("Teacher email", { exact: true })
    .fill("rivera@example.edu");
  const classChecks = page.locator('input[name="classIds"]');
  await classChecks.nth(0).check();
  await classChecks.nth(1).check();
  await page
    .getByLabel("Teacher notes", { exact: true })
    .fill("Physics and history instructor");
  await page.getByRole("button", { name: "Save teacher", exact: true }).click();
  await page.getByRole("heading", { name: "Dr. Rivera", exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  const teacher = snapshot.teachers[0];
  assert.ok(teacher);
  assert.deepEqual(teacher.classIds, [ids.classId, ids.historyId]);

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page
    .getByRole("heading", { name: "Teacher evidence", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add teacher evidence", exact: true })
    .click();
  await page.getByLabel("Evidence class", { exact: true }).selectOption(ids.classId);
  await page.getByLabel("Evidence teacher", { exact: true }).selectOption(teacher.id);
  await page.getByLabel("Evidence title", { exact: true }).fill("Kinematics feedback");
  await page.getByLabel("Evidence type", { exact: true }).selectOption("teacher-feedback");
  await page.getByLabel("Evidence source", { exact: true }).selectOption("manual");
  await page.getByLabel("Evidence task", { exact: true }).selectOption(ids.taskId);
  await page
    .getByLabel("Teacher comments", { exact: true })
    .fill("Show the sign convention.");
  await page
    .getByRole("button", { name: "Save teacher evidence", exact: true })
    .click();
  await page.getByText("Kinematics feedback", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.teacherEvidence.length, 1);
  assert.equal(snapshot.teacherEvidence[0].teacherId, teacher.id);

  await page.getByRole("button", { name: "Teachers", exact: true }).click();
  await page
    .getByText("1 linked teacher-evidence record", { exact: false })
    .waitFor();
  await page.screenshot({ path: join(output, "teachers.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(await firstVideo.path(), join(output, "teachers-operated.webm"));

  await launch();
  await page.getByRole("button", { name: "Teachers", exact: true }).click();
  await page.getByRole("heading", { name: "Dr. Rivera", exact: true }).waitFor();
  await page
    .getByText("1 linked teacher-evidence record", { exact: false })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.teachers.length, 1);
  assert.equal(snapshot.teacherEvidence.length, 1);

  await page.getByRole("button", { name: "Forget teacher", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "linked evidence" })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.teachers.length, 1);

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Forget evidence", exact: true }).click();
  await page.getByText("No teacher evidence recorded yet.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Teachers", exact: true }).click();
  await page.getByRole("button", { name: "Forget teacher", exact: true }).click();
  await page.getByText("No teachers recorded yet.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.teachers.length, 0);
  assert.equal(snapshot.teacherEvidence.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Teacher identity links to multiple classes and teacher evidence, persists across restart, blocks unsafe removal, and forgets safely after unlinking evidence.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
