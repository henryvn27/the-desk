import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-auto-"));
const output = resolve("artifacts/auto-plan");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data },
    recordVideo: { dir: output },
  });
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((p) => p.url().endsWith("#main"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Plan", exact: true }).waitFor();
}
async function capture(title) {
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await page.getByLabel("What needs doing?").fill(title);
  await page.getByLabel("Estimated minutes", { exact: true }).fill("30");
  await page.getByLabel("I have confirmed").check();
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
try {
  await launch();
  await page.getByLabel("Class name", { exact: true }).fill("Physics");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).waitFor();
  await capture("Problems 8–14");
  const auto = await page.evaluate(() => window.desk.snapshot());
  assert.equal(auto.planningMode, "auto-plan");
  assert.equal(auto.studyBlocks.length, 1);
  assert.equal(auto.studyBlocks[0].origin, "auto-plan");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByText("Plan change history", { exact: true }).waitFor();
  await page.getByText("Plan change history", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "auto-plan.png") });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Planning mode", { exact: true })
    .selectOption("suggest");
  await page
    .getByRole("button", { name: "Save planning behavior", exact: true })
    .click();
  await page.getByText("Planning behavior saved.", { exact: true }).waitFor();
  await capture("Optional corrections");
  const suggested = await page.evaluate(() => window.desk.snapshot());
  assert.equal(suggested.planningMode, "suggest");
  assert.equal(suggested.tasks.length, 2);
  assert.deepEqual(suggested.studyBlocks, auto.studyBlocks);
  await app.close();
  app = undefined;
  await launch();
  const restored = await page.evaluate(() => window.desk.snapshot());
  assert.equal(restored.planningMode, "suggest");
  assert.deepEqual(restored.studyBlocks, auto.studyBlocks);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Planning mode", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Planning mode", { exact: true }).inputValue(),
    "suggest",
  );
  await page
    .getByLabel("Planning mode", { exact: true })
    .selectOption("auto-plan");
  await page
    .getByRole("button", { name: "Save planning behavior", exact: true })
    .click();
  await page.getByText("Planning behavior saved.", { exact: true }).waitFor();
  // Seed an active session through the trusted API; capture/end are exercised in UI.
  await page.evaluate(
    (taskId) => window.desk.command({ type: "session.start", taskId }),
    auto.tasks[0].id,
  );
  await capture("Captured during session");
  const pending = (
    await page.evaluate(() => window.desk.snapshot())
  ).tasks.find((t) => t.title === "Captured during session");
  assert.equal(pending.autoPlanPending, true);
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).studyBlocks.filter(
      (b) => b.taskId === pending.id,
    ).length,
    0,
  );
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page
    .getByText(
      "Auto-plan will reserve time after the active study session ends.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({ path: join(output, "auto-plan-deferred.png") });
  await app.close();
  app = undefined;
  await launch();
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).tasks.find(
      (t) => t.id === pending.id,
    ).autoPlanPending,
    true,
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "End · keep unfinished", exact: true })
    .click();
  await page
    .getByRole("button", { name: "End · keep unfinished", exact: true })
    .waitFor({ state: "hidden" });
  const ended = await page.evaluate(() => window.desk.snapshot());
  assert.equal(
    ended.tasks.find((t) => t.id === pending.id).autoPlanPending,
    undefined,
  );
  assert.equal(
    ended.studyBlocks.filter((b) => b.taskId === pending.id).length,
    1,
  );
  assert.deepEqual(
    ended.studyBlocks.find((b) => b.id === auto.studyBlocks[0].id),
    auto.studyBlocks[0],
  );
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "auto-plan-resumed.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: default Auto-plan capture, visible change record, Suggest switch, preserved commitments, restart mode and deferred capture after session end",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
