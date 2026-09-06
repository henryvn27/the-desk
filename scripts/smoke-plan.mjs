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
  assert.deepEqual(errors, []);
  console.log(
    "PASS: reserve, lock, reject unapproved edit, approve edit, restart persistence, locked cancellation approval and retained history",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
