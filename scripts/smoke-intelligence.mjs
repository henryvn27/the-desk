import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-intelligence-"));
const output = resolve("artifacts/intelligence");
await mkdir(output, { recursive: true });
let app;
const errors = [];
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
    recordVideo: { dir: output },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("What are you working on?", { exact: true }).waitFor();

  const seeded = await page.evaluate(async () => {
    const classSnapshot = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const classId = classSnapshot.classes.at(-1).id;
    const taskSnapshot = await window.desk.command({
      type: "task.create",
      input: {
        title: "Forces problem set",
        classId,
        dueAt: "2026-09-10T23:00:00.000Z",
        minutes: 45,
        resource: null,
        notes: "Checked fixture task",
        deadlineConfirmed: true,
      },
    });
    const taskId = taskSnapshot.tasks.at(-1).id;
    const conceptSnapshot = await window.desk.command({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskId],
        name: "Friction",
        status: "learning",
        preparedness: "developing",
        retentionMode: "course",
        reviewDue: null,
        attempts: 0,
        unaidedCorrect: 0,
        unaidedTotal: 0,
        hintCount: 0,
        lastReviewedAt: null,
        evidenceNote: "Checked fixture evidence",
      },
    });
    const conceptId = conceptSnapshot.concepts.at(-1).id;
    await window.desk.command({
      type: "attempt.create",
      input: {
        classId,
        taskId,
        conceptIds: [conceptId],
        result: "incorrect",
        unaided: true,
        hintCount: 0,
        notes: "Sign error",
        attemptedAt: "2026-09-07T08:00:00.000Z",
      },
    });
    const intelligence = await window.desk.intelligence();
    const inference = await window.desk.infer({
      sourceKind: "capture",
      sourceId: "smoke-capture",
      sourceRevision: 0,
      title: "Forces problem set",
      text: "AP Physics C\nForces problem set\nDue 2026-09-10T23:00:00Z\nhttps://example.edu/forces",
      capturedAt: "2026-09-07T09:00:00.000Z",
      classId,
    });
    await window.desk.command({
      type: "inbox.capture",
      text: "Homework due Friday",
      timeZone: "UTC",
    });
    return { intelligence, inference };
  });
  assert.equal(seeded.intelligence.nextAction.kind, "start-task");
  assert.equal(seeded.intelligence.evidence.attempts, 1);
  assert.equal(seeded.intelligence.classes[0].learningObjective.conceptId.length > 0, true);
  assert.equal(seeded.inference.fields.classId.confidence, "high");
  assert.equal(seeded.inference.fields.dueAt.value, "2026-09-10T23:00:00.000Z");
  assert.equal(seeded.inference.fields.title.provenance[0].sourceId, "smoke-capture");
  assert.equal(seeded.inference.provider, undefined);

  await page.locator("details.sidebar-more > summary").click();
  await page.getByRole("button", { name: "Capture Inbox", exact: true }).click();
  await page.getByRole("heading", { name: "Capture Inbox", exact: true }).waitFor();
  await page.getByRole("button", { name: "Review capture", exact: true }).click();
  await page.getByRole("button", { name: "Resolve ambiguous fields with Desk AI", exact: true }).waitFor();
  await page.screenshot({ path: join(output, "capture-inference-review.png") });
  await page.getByRole("button", { name: "Resolve ambiguous fields with Desk AI", exact: true }).click();
  await page.getByRole("button", { name: "Resolve ambiguous fields with Desk AI", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  const video = page.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "intelligence-operated.webm"));
  console.log("PASS: packaged intelligence API keeps canonical evidence/provenance, deterministic inference avoids provider calls when complete, and Capture review degrades safely without a provider.");
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
