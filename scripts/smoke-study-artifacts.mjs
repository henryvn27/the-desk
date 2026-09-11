import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-study-artifacts-"));
const output = resolve("artifacts/study-artifacts");
await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
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
      type: "source.create",
      input: {
        title: "Forces handout",
        text: "Net force equals mass times acceleration.",
        classIds: [classId],
        taskIds: [],
        format: "text",
        sourceUrl: null,
      },
    });
    const results = {};
    for (const type of ["quiz", "flashcards", "audio", "video"]) {
      const artifact = await window.desk.studyGenerate({ type, material: { classId } });
      results[type] = { id: artifact.id, status: artifact.status, payload: artifact.payload?.kind };
    }
    return results;
  });
  assert.deepEqual(Object.fromEntries(Object.entries(state).map(([type, value]) => [type, value.status])), {
    quiz: "ready",
    flashcards: "ready",
    audio: "ready",
    video: "ready",
  });
  assert.equal(state.quiz.payload, "quiz");
  assert.equal(state.flashcards.payload, "flashcards");

  const input = page.getByLabel("Ask The Desk", { exact: true });
  await input.fill("quiz me for AP Physics C");
  await input.press("Meta+Enter");
  await page.getByText(/native quiz activity/i).waitFor();
  await page.getByRole("button", { name: "Start quiz", exact: true }).click();
  await page.locator(".study-artifact-workspace").waitFor();
  await page.getByText("Which statement is best supported", { exact: false }).waitFor();
  await page.locator(".study-artifact-workspace").scrollIntoViewIfNeeded();
  await page.locator(".study-choice-list button").first().click();
  await page.getByRole("button", { name: "Check answer", exact: true }).click();
  await page.getByRole("status").filter({ hasText: /Correct\.|Not quite\./ }).waitFor();
  assert.equal((await page.evaluate(() => window.desk.snapshot())).attempts.length, 1);
  await page.screenshot({ path: join(output, "study-quiz.png") });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await input.fill("make flashcards for AP Physics C");
  await input.press("Meta+Enter");
  await page.getByText(/native flashcards activity/i).waitFor();
  await page.getByRole("button", { name: "Start flashcards", exact: true }).click();
  await page.locator(".study-artifact-workspace").waitFor();
  await page.getByRole("button", { name: "Reveal", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "study-flashcards.png") });
  console.log(JSON.stringify({ result: "PASS", flows: ["material-set references existing Source", "native Quiz", "native Flashcards", "native Audio artifact", "native Video artifact", "Chat study action"] }));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
