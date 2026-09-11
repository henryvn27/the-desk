import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { compareStudyQuality } from "../packages/study/evaluation.ts";

  const data = await mkdtemp(join(tmpdir(), "desk-study-quality-"));
const output = resolve("artifacts/study-quality");
await mkdir(output, { recursive: true });
let app;
async function waitForController() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = app.windows().find((window) => window.url().endsWith("#controller"));
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Study controller did not open");
}
try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, DESK_ENABLE_DEVELOPMENT_KEY: "0", TZ: "UTC" },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const first = await window.desk.command({ type: "class.create", name: "AP Calculus" });
    const classId = first.classes.at(-1).id;
    const task = await window.desk.command({ type: "task.create", input: { title: "Derivative quiz", classId, dueAt: null, minutes: 30, resource: null, notes: "", deadlineConfirmed: true } });
    const taskId = task.tasks.at(-1).id;
    await window.desk.command({ type: "concept.create", input: { classId, taskIds: [taskId], name: "Derivative rules", status: "learning", preparedness: "developing", retentionMode: "course", reviewDue: null, attempts: 0, unaidedCorrect: 0, unaidedTotal: 0, hintCount: 0, lastReviewedAt: null, evidenceNote: "" } });
    await window.desk.command({ type: "assessment.create", input: { classId, title: "Unit test", kind: "quiz", taskIds: [taskId], dueAt: "2026-09-20T12:00:00.000Z", gradeCategoryId: null, notes: "" } });
    await window.desk.command({ type: "session.start", taskId, mode: "quiz" });
  });
  const quizController = await waitForController();
  await quizController.getByText("Quiz mode", { exact: true }).waitFor();
  await quizController.getByText("Complete a response before asking for support", { exact: false }).waitFor();
  await quizController.screenshot({ path: join(output, "quiz-session.png") });
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  const quiz = snapshot.sessions.find((session) => !session.endedAt);
  assert.equal(quiz.activityState.mode, "quiz");
  const firstActivity = quiz.activityState.activities[0];
  await page.evaluate(async (activityId) => {
    await window.desk.command({ type: "session.activity", activityId, action: "hint" });
  }, firstActivity.id);
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.sessions.find((session) => !session.endedAt).activityState.activities[0].hintCount, 1);
  await page.evaluate(async () => {
    const active = (await window.desk.snapshot()).sessions.find((session) => !session.endedAt);
    await window.desk.command({ type: "session.activity", activityId: active.activityState.activities[0].id, action: "complete" });
    await window.desk.command({ type: "session.end", completed: false });
  });
  await page.getByText("Session saved", { exact: true }).waitFor();
  const ended = await page.evaluate(() => window.desk.snapshot()).then((next) => next.sessions.find((session) => session.endedAt));
  await page.evaluate(async ({ id, activityId, conceptId }) => {
    await window.desk.command({ type: "session.review", id, notes: "Checked the derivative setup.", remainingMinutes: null, attempts: [{ conceptIds: [conceptId], result: "correct", unaided: true, hintCount: 0, notes: "Power rule setup was correct.", activityId, activityKind: "quiz" }] });
  }, { id: ended.id, activityId: firstActivity.id, conceptId: (await page.evaluate(() => window.desk.snapshot())).concepts[0].id });
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.sessions.at(-1).summary.evidenceQuality, "useful");

  await page.evaluate(async () => {
    const current = await window.desk.snapshot();
    const task = current.tasks[0];
    await window.desk.command({ type: "task.update", id: task.id, input: { ...task, completed: false }, deadlineChangeApproved: true });
  }).catch(() => undefined);
  // A second, unfinished task makes the fixed exam path explicit without mutating the quiz evidence.
  const second = await page.evaluate(async () => {
    const current = await window.desk.snapshot();
    return (await window.desk.command({ type: "task.create", input: { title: "Derivative exam", classId: current.classes[0].id, dueAt: null, minutes: 35, resource: null, notes: "", deadlineConfirmed: true } })).tasks.at(-1).id;
  });
  await page.evaluate(async (taskId) => window.desk.command({ type: "session.start", taskId, mode: "exam" }), second);
  const examController = await waitForController();
  await examController.getByText("Exam mode", { exact: true }).waitFor();
  await examController.screenshot({ path: join(output, "exam-session.png") });
  snapshot = await page.evaluate(() => window.desk.snapshot());
  const examActivity = snapshot.sessions.find((session) => !session.endedAt).activityState.activities[0];
  assert.equal(examActivity.hintsAllowed, false);
  await assert.rejects(page.evaluate(async (activityId) => window.desk.command({ type: "session.activity", activityId, action: "hint" }), examActivity.id), /does not provide hints/);

  await page.evaluate(() => window.desk.lens({ question: "Check my derivative setup.", activityKind: "check" }));
  let lens;
  for (let attempt = 0; attempt < 100; attempt++) {
    lens = app.windows().find((window) => window.url().endsWith("#lens"));
    if (lens) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(lens, "Lens opened");
  await lens.getByLabel("Draw a freeform Lens selection", { exact: true }).waitFor();
  await lens.mouse.move(150, 150); await lens.mouse.down(); await lens.mouse.move(360, 150); await lens.mouse.move(360, 300); await lens.mouse.move(150, 300); await lens.mouse.up();
  await lens.getByLabel("Ask Lens", { exact: true }).waitFor();
  assert.equal(await lens.getByLabel("Ask Lens", { exact: true }).inputValue(), "Check my derivative setup.");
  await lens.screenshot({ path: join(output, "lens-check-contract.png") });
  await lens.evaluate(() => window.desk.dismiss()).catch(() => undefined);
  const quality = compareStudyQuality(
    [
      { scenario: "check", answerLeakage: true, hintUseful: false, diagnosticAccurate: false, repeatedQuestion: true, transferQuality: false, citationAccurate: true, evidenceCorrect: false, completed: true },
      { scenario: "hint", answerLeakage: true, hintUseful: false, diagnosticAccurate: false, repeatedQuestion: true, transferQuality: false, citationAccurate: true, evidenceCorrect: false, completed: true },
    ],
    [
      { scenario: "check", answerLeakage: false, hintUseful: true, diagnosticAccurate: true, repeatedQuestion: false, transferQuality: true, citationAccurate: true, evidenceCorrect: true, completed: true },
      { scenario: "hint", answerLeakage: false, hintUseful: true, diagnosticAccurate: true, repeatedQuestion: false, transferQuality: true, citationAccurate: true, evidenceCorrect: true, completed: true },
    ],
  );
  console.log(JSON.stringify({ result: "PASS", flows: ["canonical Student Model activity selection", "quiz hint and evidence", "session-end inference", "fixed exam hint prohibition", "shared Lens CHECK context"], quality, artifacts: output }, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
