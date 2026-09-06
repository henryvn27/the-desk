import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-plans-ui-"));
const output = resolve("artifacts/plans");
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
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
      TZ: "UTC",
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
  await page.getByRole("button", { name: "Plan", exact: true }).waitFor();
}

try {
  await launch();
  const ids = await page.evaluate(async () => {
    const created = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const classId = created.classes.at(-1).id;
    const saved = await window.desk.command({
      type: "task.create",
      input: {
        title: "Kinematics set",
        classId,
        dueAt: "2099-09-08T23:00:00.000Z",
        minutes: 45,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    return { taskId: saved.tasks.at(-1).id };
  });
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("heading", { name: "Your plan", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Plan history", exact: true })
    .waitFor();
  await page.getByText("Auto-plan", { exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.plans.length, 1);
  assert.equal(snapshot.plans[0].trigger, "auto-plan");
  assert.ok(snapshot.plans[0].blockIds.includes(snapshot.studyBlocks[0].id));
  await page
    .getByRole("button", { name: "Preview rebalance", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Review proposed changes", exact: true })
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
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.plans.length, 2);
  assert.equal(snapshot.plans[0].trigger, "rebalance");
  assert.equal(snapshot.tasks[0].id, ids.taskId);
  await page.screenshot({ path: join(output, "plans.png") });
  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "plans-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByText("Rebalance", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.plans.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: committed Auto-plan and rebalance versions persist, remain inspectable, and preserve task state.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
