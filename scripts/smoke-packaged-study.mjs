import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-packaged-study-"));
const output = resolve("artifacts/study-artifacts");
await mkdir(output, { recursive: true });
let app;

try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_TEST_BACKGROUND: "1",
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
      DESK_STUDY_ENGINE: "fake",
    },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();

  const state = await page.evaluate(async () => {
    let snapshot = await window.desk.command({ type: "class.create", name: "AP Physics C" });
    const classId = snapshot.classes[0].id;
    snapshot = await window.desk.command({
      type: "task.create",
      input: {
        title: "Review forces",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const taskId = snapshot.tasks[0].id;
    snapshot = await window.desk.command({
      type: "source.create",
      input: {
        title: "Forces handout",
        text: "Net force equals mass times acceleration.",
        classIds: [classId],
        taskIds: [taskId],
        format: "text",
        sourceUrl: null,
      },
    });
    const results = {};
    for (const type of ["quiz", "flashcards", "audio", "video"]) {
      const artifact = await window.desk.studyGenerate({ type, material: { classId } });
      results[type] = { status: artifact.status, payload: artifact.payload?.kind };
    }
    return { results, taskId };
  });
  assert.deepEqual(Object.fromEntries(Object.entries(state.results).map(([type, value]) => [type, value.status])), {
    quiz: "ready",
    flashcards: "ready",
    audio: "ready",
    video: "ready",
  });
  assert.equal(state.results.quiz.payload, "quiz");
  assert.equal(state.results.flashcards.payload, "flashcards");

  const input = page.getByLabel("Ask The Desk", { exact: true });
  await input.fill("quiz me for Review forces");
  await input.press("Meta+Enter");
  await page.getByText(/native quiz activity/i).waitFor();
  await page.getByRole("button", { name: "Start quiz", exact: true }).click();
  await page.locator(".study-artifact-workspace").waitFor();
  await page.getByText("Which statement is best supported", { exact: false }).waitFor();
  const postStart = await page.evaluate(async () => {
    const snapshot = await window.desk.snapshot();
    const artifact = snapshot.studyArtifacts.at(-1);
    const material = artifact ? snapshot.studyMaterialSets.find((set) => set.id === artifact.materialSetId) : null;
    return { sessions: snapshot.sessions, artifact: artifact ? { status: artifact.status, materialSetId: artifact.materialSetId } : null, material: material ? { classId: material.classId, taskId: material.taskId, sourceIds: material.sourceIds } : null };
  });
  assert.ok(postStart.sessions.some((session) => !session.endedAt && session.taskId));
  await page.locator(".study-choice-list button").first().click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /Correct\.|Not quite\./ }).waitFor();
  assert.equal((await page.evaluate(() => window.desk.snapshot())).attempts.length, 1);
  await page.screenshot({ path: join(output, "packaged-study-quiz.png") });

  console.log(JSON.stringify({ result: "PASS", flows: ["packaged fake material generation", "packaged native Quiz", "packaged Chat study action", "packaged Attempt persistence"] }));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
