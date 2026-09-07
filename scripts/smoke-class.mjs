import { _electron as electron } from "playwright";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-class-ui-"));
const output = resolve("artifacts/class");
await mkdir(output, { recursive: true });
let app;
let page;
const errors = [];

try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0", TZ: "UTC" },
    recordVideo: { dir: output },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    page = app.windows().find((window) => window.url().endsWith("#main"));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(page, "Main Desk window opened");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("Make room for focus.").waitFor();
  await page.evaluate(async () => {
    await window.desk.command({ type: "planning.preferences", input: { studyStart: "08:00", sleepCutoff: "22:00", studyDays: [0, 1, 2, 3, 4, 5, 6], bufferPercent: 15 } });
    const created = await window.desk.command({ type: "class.create", name: "AP Physics C" });
    const classId = created.classes.at(-1).id;
    const track = await window.desk.command({ type: "track.create", input: { classId, name: "Mechanics", notes: "" } });
    const trackId = track.tracks.at(-1).id;
    const task = await window.desk.command({ type: "task.create", input: { title: "Problem Set 4", classId, dueAt: "2026-09-08T22:00:00.000Z", minutes: 45, resource: null, notes: "", deadlineConfirmed: true } });
    const taskId = task.tasks.at(-1).id;
    await window.desk.command({ type: "unit.create", input: { classId, trackId, name: "Forces", kind: "unit", sequence: 2, notes: "", taskIds: [taskId] } });
    const concept = await window.desk.command({ type: "concept.create", input: { classId, taskIds: [taskId], name: "Friction", status: "developing", preparedness: "developing", retentionMode: "course", reviewDue: null, attempts: 0, unaidedCorrect: 0, unaidedTotal: 0, hintCount: 0, lastReviewedAt: null, evidenceNote: "", prerequisiteConceptIds: [] } });
    const conceptId = concept.concepts.at(-1).id;
    const assessment = await window.desk.command({ type: "assessment.create", input: { classId, title: "Unit 2 Test", kind: "test", taskIds: [taskId], dueAt: "2026-09-10T22:00:00.000Z", gradeCategoryId: null, notes: "" } });
    const assessmentId = assessment.assessments.at(-1).id;
    await window.desk.command({ type: "source.create", input: { title: "Teacher slides", text: "Friction and free-body diagrams", classIds: [classId], taskIds: [taskId], format: "slides", sourceUrl: null, kind: "class-material" } });
    const teacher = await window.desk.command({ type: "teacher.create", input: { name: "Dr. Rivera", email: "", notes: "Office hours Thursday", classIds: [classId] } });
    const teacherId = teacher.teachers.at(-1).id;
    await window.desk.command({ type: "evidence.create", input: { classId, teacherId, assessmentId, taskId, title: "Test feedback", kind: "teacher-feedback", source: "manual", scoreEarned: null, scorePossible: null, teacherComments: "Use a free-body diagram.", rubric: "", observations: "", conceptIds: [conceptId], includeInTeacherModeling: true, capturedAt: "2026-09-06T12:00:00.000Z" } });
    const category = await window.desk.command({ type: "grade.category", input: { classId, name: "Tests", weight: 60 } });
    await window.desk.command({ type: "grade.entry", input: { categoryId: category.gradeCategories.at(-1).id, title: "Unit 1 Test", earned: 42, possible: 50 } });
  });
  await page.getByRole("button", { name: "AP Physics C", exact: true }).click();
  await page.getByRole("heading", { name: "AP Physics C", exact: true }).waitFor();
  await page.getByText("What’s next", { exact: true }).waitFor();
  await page.getByText("Where are we?", { exact: true }).waitFor();
  await page.getByText("What matters for learning", { exact: true }).waitFor();
  await page.getByText("Unit 2 Test", { exact: true }).waitFor();
  await page.getByText("Teacher context", { exact: true }).waitFor();
  await page.getByText("Grade evidence", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "class-overview.png") });
  assert.equal(await page.getByRole("button", { name: "Start next study", exact: true }).count(), 1);
  assert.ok((await page.getByText("Teacher slides", { exact: true }).count()) >= 1);
  assert.deepEqual(errors, []);
  const video = page.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "class-overview-operated.webm"));
  console.log(JSON.stringify({ result: "PASS", flows: ["class graph seeded through V1 commands", "class overview renders progression/next/learning/assessment/teacher/grade evidence", "class material is visible without duplicating domain records"], artifacts: output }, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
