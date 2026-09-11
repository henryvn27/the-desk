import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-student-model-"));
const output = resolve("artifacts/student-model");
await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
      TZ: "UTC",
    },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  const openMoreTools = async () => {
    const more = page.locator("details.sidebar-more");
    if (!(await more.evaluate((element) => element.open)))
      await more.locator("summary").click();
  };

  await page.evaluate(async () => {
    const classRecord = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const classId = classRecord.classes.at(-1).id;
    const taskIds = [];
    for (const title of ["Vectors drill", "Projectile mixed set", "Projectile lab"]) {
      const snapshot = await window.desk.command({
        type: "task.create",
        input: {
          title,
          classId,
          dueAt: null,
          minutes: 30,
          resource: null,
          notes: "",
          deadlineConfirmed: true,
        },
      });
      taskIds.push(snapshot.tasks.at(-1).id);
    }
    const prerequisiteSnapshot = await window.desk.command({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskIds[0]],
        name: "Vectors",
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
    const prerequisiteId = prerequisiteSnapshot.concepts.at(-1).id;
    const advancedSnapshot = await window.desk.command({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskIds[1], taskIds[2]],
        prerequisiteConceptIds: [prerequisiteId],
        name: "Projectile motion",
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
    const advancedId = advancedSnapshot.concepts.at(-1).id;
    for (const [index, taskId] of taskIds.slice(1).entries()) {
      await window.desk.command({
        type: "attempt.create",
        input: {
          classId,
          taskId,
          conceptIds: [advancedId],
          result: "correct",
          unaided: true,
          hintCount: 0,
          notes: "",
          attemptedAt: `2026-09-0${index + 2}T12:00:00.000Z`,
        },
      });
    }
    await window.desk.command({
      type: "assessment.create",
      input: {
        classId,
        title: "Unit 1 Midterm",
        kind: "midterm",
        taskIds: [taskIds[1], taskIds[2]],
        dueAt: "2026-09-20T12:00:00.000Z",
        gradeCategoryId: null,
        notes: "",
      },
    });
  });

  await openMoreTools();
  await page.getByRole("button", { name: "Concepts", exact: true }).click();
  const conceptHeading = page.getByRole("heading", {
    name: "Concepts & preparedness",
    exact: true,
  });
  await conceptHeading.waitFor();
  await page.getByText("Projectile motion", { exact: true }).waitFor();
  const projectile = page.locator("article.source").filter({
    hasText: "Projectile motion",
  });
  await projectile.getByText(/Student Model:/).waitFor();
  await projectile.getByText(/Prerequisite gap: Vectors/).waitFor();
  await page.screenshot({ path: join(output, "concepts-student-model.png") });

  await openMoreTools();
  await page.getByRole("button", { name: "Assessments", exact: true }).click();
  await page.getByRole("heading", { name: "Assessments", exact: true }).waitFor();
  await page.getByText(/Student Model readiness:/).waitFor();
  await page.screenshot({ path: join(output, "assessment-readiness.png") });

  await page.evaluate(async () => {
    const snapshot = await window.desk.snapshot();
    const task = snapshot.tasks.find((item) => item.title === "Projectile mixed set");
    if (!task) throw Error("Student Model smoke task was not created.");
    await window.desk.command({ type: "session.start", taskId: task.id });
    await window.desk.command({ type: "session.end", completed: false });
  });
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByText("Session saved", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Add details", exact: true }).click();
  await page
    .getByRole("button", { name: "Add confidence check", exact: true })
    .click();
  await page.getByText("Confidence check · optional", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "session-confidence.png") });
  await page.getByRole("button", { name: "Back", exact: true }).click();

  const snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.attempts.length, 2);
  assert.equal(snapshot.concepts.length, 2);
  assert.equal(snapshot.assessments.length, 1);
  assert.deepEqual(snapshot.concepts[1].prerequisiteConceptIds?.length, 1);
  console.log(
    "PASS: desktop Student Model surface shows derived concept dimensions, prerequisite explanation, and assessment readiness from V1 evidence.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
