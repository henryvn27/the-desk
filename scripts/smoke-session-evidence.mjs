import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-session-evidence-"));
const output = resolve("artifacts/session-evidence");
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
      TZ: "UTC",
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
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
  await page.getByText("Make room for focus.").waitFor();
}

try {
  await launch();
  await page.evaluate(async () => {
    await window.desk.command({ type: "planning.mode", mode: "suggest" });
    await window.desk.command({
      type: "planning.preferences",
      input: {
        studyStart: "00:00",
        sleepCutoff: "23:59",
        studyDays: [0, 1, 2, 3, 4, 5, 6],
        bufferPercent: 15,
      },
    });
  });
  await page.getByLabel("Class name", { exact: true }).fill("Physics");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).waitFor();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page.getByRole("button", { name: "Enter manually", exact: true }).click();
  await page.getByLabel("What needs doing?").fill("Check force directions");
  await page.getByLabel("Estimated minutes").fill("30");
  await page.getByLabel("I have confirmed").check();
  await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await page.getByRole("button", { name: "Start session →", exact: true }).waitFor();

  await page.evaluate(async () => {
    const state = await window.desk.snapshot();
    const task = state.tasks[0];
    await window.desk.command({
      type: "concept.create",
      input: {
        classId: task.classId,
        taskIds: [task.id],
        name: "Force direction",
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
  });

  await page.getByRole("button", { name: "Start session →", exact: true }).click();
  await page.getByRole("button", { name: "End · keep unfinished", exact: true }).click();
  await page.getByRole("button", { name: "Add details", exact: true }).click();
  await page.getByRole("button", { name: "Record a checked attempt", exact: true }).click();
  await page.locator('select[name="evidenceConceptIds"]').selectOption({ label: "Force direction" });
  await page.locator('select[name="evidenceResult"]').selectOption("correct");
  await page.locator('textarea[name="evidenceNotes"]').fill("Direction was correct.");
  await page.screenshot({ path: join(output, "session-review-with-evidence.png") });
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page.getByRole("region", { name: "Session wrap-up" }).waitFor({ state: "hidden" });

  const snapshot = await page.evaluate(() => window.desk.snapshot());
  const session = snapshot.sessions.at(-1);
  const concept = snapshot.concepts.find((item) => item.name === "Force direction");
  assert.ok(session?.evidenceAttemptIds?.length === 1, "session stores evidence attempt id");
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0].result, "correct");
  assert.deepEqual(snapshot.attempts[0].conceptIds, [concept.id]);
  assert.equal(snapshot.attempts[0].unaided, true);
  assert.equal(concept.attempts, 1);
  assert.equal(concept.unaidedCorrect, 1);
  assert.equal(concept.unaidedTotal, 1);
  assert.equal(concept.status, "learning");
  assert.deepEqual(errors, []);

  const video = page.video();
  await app.close();
  app = undefined;
  if (video) await copyFile(await video.path(), join(output, "session-evidence-operated.webm"));
  console.log("PASS: installed session review records checked learning evidence, updates concept counters, and preserves the non-mastery status");
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
