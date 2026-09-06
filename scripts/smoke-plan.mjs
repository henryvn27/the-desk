import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-plan-"));
const output = resolve("artifacts/plan");
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
try {
  await launch();
  await page.evaluate(async () => {
    const state = await window.desk.command({
      type: "class.create",
      name: "Physics",
    });
    await window.desk.command({
      type: "task.create",
      input: {
        classId: state.classes[0].id,
        title: "Work through problems 8–14",
        minutes: 90,
        dueAt: null,
        deadlineConfirmed: true,
        resource: null,
        notes: "",
      },
    });
  });
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Reserve time", exact: true })
    .first()
    .click();
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const local = new Date(+start - start.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Start time", { exact: true }).fill(local);
  await page.getByLabel("Minutes", { exact: true }).fill("45");
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page.getByText("Study block saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Edit block", exact: true }).click();
  await page.getByLabel("Lock this block", { exact: true }).check();
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page.getByRole("button", { name: "Edit block", exact: true }).waitFor();
  let saved = (await page.evaluate(() => window.desk.snapshot()))
    .studyBlocks[0];
  assert.equal(saved.locked, true);
  await page.getByRole("button", { name: "Edit block", exact: true }).click();
  await page.getByLabel("Minutes", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page
    .getByText("Confirm changing this locked block.", { exact: false })
    .waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).studyBlocks[0],
    saved,
  );
  await page
    .getByLabel("I approve moving or unlocking this locked block", {
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page.getByRole("button", { name: "Edit block", exact: true }).waitFor();
  saved = (await page.evaluate(() => window.desk.snapshot())).studyBlocks[0];
  assert.equal(saved.minutes, 60);
  assert.equal(saved.locked, true);
  await page.screenshot({ path: join(output, "saved-plan.png") });
  await app.close();
  app = undefined;
  await launch();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Edit block", exact: true }).waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).studyBlocks[0],
    saved,
  );
  await page
    .locator(".plan-day-block")
    .dragTo(page.locator(".plan-day").nth(2));
  await page
    .getByText("Review the new day and save to move this block.", {
      exact: true,
    })
    .waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).studyBlocks[0],
    saved,
  );
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page
    .getByText("Confirm changing this locked block.", { exact: false })
    .waitFor();
  await page
    .getByLabel("I approve moving or unlocking this locked block", {
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "Save block", exact: true }).click();
  await page.getByText("Study block saved.", { exact: true }).waitFor();
  const moved = (await page.evaluate(() => window.desk.snapshot()))
    .studyBlocks[0];
  const expected = new Date(saved.start);
  const target = new Date();
  target.setDate(target.getDate() + 2);
  expected.setFullYear(
    target.getFullYear(),
    target.getMonth(),
    target.getDate(),
  );
  assert.equal(moved.start, expected.toISOString());
  assert.equal(moved.locked, true);
  saved = moved;
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Day view must not widen the app window",
  );
  await page.screenshot({ path: join(output, "dragged-plan.png") });
  await page.getByRole("button", { name: "Edit block", exact: true }).click();
  await page
    .getByRole("button", { name: "Release reserved time", exact: true })
    .click();
  await page
    .getByText("Confirm cancelling this locked block.", { exact: false })
    .waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).studyBlocks[0],
    saved,
  );
  await page
    .getByLabel("I approve cancelling this locked block; keep the assignment", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Release reserved time", exact: true })
    .click();
  await page
    .getByText(
      "Reserved time released. The assignment still needs its remaining work.",
      { exact: true },
    )
    .waitFor();
  const cancelled = (await page.evaluate(() => window.desk.snapshot()))
    .studyBlocks[0];
  assert.ok(cancelled.cancelledAt);
  await page.getByText("Released blocks", { exact: true }).click();
  await page.screenshot({ path: join(output, "released-plan.png") });
  await app.close();
  app = undefined;
  await launch();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByText("Released blocks", { exact: true }).waitFor();
  const final = await page.evaluate(() => window.desk.snapshot());
  assert.deepEqual(final.studyBlocks[0], cancelled);
  assert.equal(final.tasks[0].completed, false);
  assert.equal(final.tasks[0].minutes, 90);
  const reserved = await page.evaluate(async () => {
    const state = await window.desk.snapshot();
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(11, 0, 0, 0);
    const created = await window.desk.command({
      type: "block.create",
      taskId: state.tasks[0].id,
      input: { start: start.toISOString(), minutes: 30 },
      beyondDeadlineApproved: false,
    });
    const block = created.studyBlocks.find((b) => !b.cancelledAt);
    await window.desk.command({
      type: "block.update",
      id: block.id,
      revision: block.revision,
      input: { start: block.start, minutes: block.minutes },
      locked: true,
      lockedChangeApproved: false,
      beyondDeadlineApproved: false,
    });
    start.setDate(start.getDate() + 1);
    return window.desk.command({
      type: "block.create",
      taskId: state.tasks[0].id,
      input: { start: start.toISOString(), minutes: 30 },
      beyondDeadlineApproved: false,
    });
  });
  await page
    .getByRole("button", { name: "Preview rebalance", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Review proposed changes", exact: true })
    .waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).studyBlocks,
    reserved.studyBlocks,
  );
  await page
    .getByRole("button", { name: "Apply rebalance", exact: true })
    .click();
  await page
    .getByText(
      "Approve the proposed commitment changes before applying them.",
      { exact: false },
    )
    .waitFor();
  await page
    .getByLabel("I approve these changes to my study commitments", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Apply rebalance", exact: true })
    .click();
  await page
    .getByText("Rebalance applied. Review the change history below.", {
      exact: true,
    })
    .waitFor();
  const rebalanced = await page.evaluate(() => window.desk.snapshot());
  assert.equal(rebalanced.planChanges.length, 1);
  assert.deepEqual(
    rebalanced.studyBlocks.find((b) => b.locked && !b.cancelledAt),
    reserved.studyBlocks.find((b) => b.locked && !b.cancelledAt),
  );
  assert.equal(
    rebalanced.studyBlocks
      .filter((b) => !b.cancelledAt)
      .reduce((sum, b) => sum + b.minutes, 0),
    90,
  );
  assert.deepEqual(rebalanced.tasks, reserved.tasks);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "rebalanced-plan.png") });
  await app.close();
  app = undefined;
  await launch();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByText("Rebalance history", { exact: true }).waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).planChanges,
    rebalanced.planChanges,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: reserve, lock, reject unapproved edit, approve edit, restart persistence, drag-to-day approval, locked cancellation approval and retained history, rebalance preview/approval/history",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
