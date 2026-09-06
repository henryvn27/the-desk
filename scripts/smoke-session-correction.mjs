import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-correction-"));
const output = resolve("artifacts/session-correction");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, TZ: "UTC" },
    recordVideo: { dir: output },
  });
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((p) => p.url().endsWith("#main"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Home", exact: true }).waitFor();
}
try {
  await launch();
  // Make the UI scenario independent of local time without seeding task progress.
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
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await page.getByLabel("What needs doing?").fill("Vectors correction");
  await page.getByLabel("I have confirmed").check();
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Start session →", exact: true })
    .click();
  await page.getByRole("button", { name: "Finish task", exact: true }).click();
  await page
    .getByRole("button", { name: "Correct completion", exact: true })
    .waitFor();
  const before = (await page.evaluate(() => window.desk.snapshot()))
    .sessions[0];
  await page
    .getByRole("button", { name: "Correct completion", exact: true })
    .click();
  await page
    .getByLabel("Task status", { exact: true })
    .selectOption("unfinished");
  await page.getByLabel("Minutes still needed", { exact: true }).fill("15");
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("Pressed Finish too soon; two problems remain.");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page
    .getByRole("region", { name: "Session wrap-up" })
    .waitFor({ state: "hidden" });
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).tasks[0].completed,
    false,
  );
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page.getByText("Study history", { exact: true }).click();
  await page.getByText("Correction history", { exact: true }).click();
  await page
    .getByText("15 minutes remaining, reported at review", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "session-corrected.png") });
  await page
    .getByRole("button", { name: "Correct completion", exact: true })
    .click();
  await page
    .getByLabel("Task status", { exact: true })
    .selectOption("finished");
  // Simulate a concurrent review while this UI holds the older revision.
  await page.evaluate(async () => {
    const s = (await window.desk.snapshot()).sessions[0];
    await window.desk.command({
      type: "session.review",
      id: s.id,
      notes: "Updated review from another window",
      remainingMinutes: null,
    });
  });
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page
    .getByText(
      "This task or review changed. Close and reopen the correction.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).tasks[0].completed,
    false,
  );
  await page
    .locator("p")
    .filter({ hasText: /^Updated review from another window$/ })
    .waitFor();
  await page
    .getByRole("button", { name: "Cancel correction", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Correct completion", exact: true })
    .click();
  await page
    .getByLabel("Task status", { exact: true })
    .selectOption("finished");
  await page
    .getByLabel("Session notes", { exact: true })
    .fill("All problems were complete after checking.");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page
    .getByRole("form", { name: "Correct session completion" })
    .waitFor({ state: "hidden" });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video)
    await copyFile(
      await video.path(),
      join(output, "session-correction-operated.webm"),
    );
  await launch();
  const state = await page.evaluate(() => window.desk.snapshot());
  assert.equal(state.tasks[0].completed, true);
  assert.equal(state.sessions[0].corrections.length, 2);
  assert.equal(
    state.sessions[0].corrections[1].previousReview.notes,
    "Updated review from another window",
  );
  assert.equal(state.sessions[0].actualMinutes, before.actualMinutes);
  assert.equal(state.sessions[0].endedAt, before.endedAt);
  assert.deepEqual(state.sessions[0].estimateAtStart, before.estimateAtStart);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: UI capture/start/finish, reopen correction, visible audit, stale-review denial, corrected finish and unchanged timing across restart",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
