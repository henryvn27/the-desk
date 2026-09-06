import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-evidence-ui-"));
const output = resolve("artifacts/evidence");
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
  await page.getByRole("button", { name: "Evidence", exact: true }).waitFor();
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
    const assessment = await window.desk.command({
      type: "assessment.create",
      input: {
        classId,
        title: "Kinematics test",
        kind: "test",
        taskIds: [taskId],
        dueAt: null,
        gradeCategoryId: null,
        notes: "",
      },
    });
    const concept = await window.desk.command({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskId],
        name: "Sign conventions",
        status: "developing",
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
    return {
      classId,
      taskId,
      assessmentId: assessment.assessments.at(-1).id,
      conceptId: concept.concepts.at(-1).id,
    };
  });

  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page
    .getByRole("heading", { name: "Teacher evidence", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add teacher evidence", exact: true })
    .click();
  await page.getByLabel("Evidence class", { exact: true }).selectOption(ids.classId);
  await page.getByLabel("Evidence title", { exact: true }).fill("Marked kinematics test");
  await page.getByLabel("Evidence type", { exact: true }).selectOption("graded-work");
  await page.getByLabel("Evidence source", { exact: true }).selectOption("manual");
  await page
    .getByLabel("Evidence assessment", { exact: true })
    .selectOption(ids.assessmentId);
  await page.getByLabel("Evidence task", { exact: true }).selectOption(ids.taskId);
  await page.getByLabel("Score earned", { exact: true }).fill("8");
  await page.getByLabel("Score possible", { exact: true }).fill("10");
  await page
    .getByLabel("Teacher comments", { exact: true })
    .fill("Show the sign convention.");
  await page.getByLabel("Evidence rubric", { exact: true }).fill("Method and units");
  await page
    .getByLabel("Evidence observations", { exact: true })
    .fill("Lost points on units.");
  await page.getByLabel("Evidence concepts", { exact: true }).selectOption(ids.conceptId);
  await page.getByLabel("Evidence captured at", { exact: true }).fill("2026-09-05T11:00");
  await page
    .getByRole("button", { name: "Save teacher evidence", exact: true })
    .click();
  await page.getByText("Marked kinematics test", { exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  let evidence = snapshot.teacherEvidence[0];
  assert.equal(evidence.authority, "teacher-reported");
  assert.equal(evidence.scoreEarned, 8);
  assert.deepEqual(evidence.conceptIds, [ids.conceptId]);

  await page.getByRole("button", { name: "Edit evidence", exact: true }).click();
  await page.getByLabel("Include in teacher modeling", { exact: true }).uncheck();
  await page
    .getByLabel("Teacher comments", { exact: true })
    .fill("Use units in the final line.");
  await page
    .getByRole("button", { name: "Save teacher evidence", exact: true })
    .click();
  await page.getByText("Use units in the final line.", { exact: false }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  evidence = snapshot.teacherEvidence[0];
  assert.equal(evidence.revision, 1);
  assert.equal(evidence.includeInTeacherModeling, false);
  await page.screenshot({ path: join(output, "evidence.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(await firstVideo.path(), join(output, "evidence-operated.webm"));

  await launch();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByText("Use units in the final line.", { exact: false }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.teacherEvidence.length, 1);
  await page.getByRole("button", { name: "Forget evidence", exact: true }).click();
  await page.getByText("No teacher evidence recorded yet.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.teacherEvidence.length, 0);
  assert.equal(snapshot.assessments.length, 1);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.concepts.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Teacher evidence records scored feedback and modeling choice, updates by revision, persists across restart, and forgets without deleting linked academic records.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
