import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-context-ui-"));
const output = resolve("artifacts/context");
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
  await page
    .getByRole("button", { name: "Academic context", exact: true })
    .waitFor();
}

try {
  await launch();
  const ids = await page.evaluate(async () => {
    const physics = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const history = await window.desk.command({
      type: "class.create",
      name: "World History",
    });
    return {
      physicsId: physics.classes.at(-1).id,
      historyId: history.classes.at(-1).id,
    };
  });

  await page
    .getByRole("button", { name: "Academic context", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Academic context", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add academic period", exact: true })
    .click();
  await page.getByLabel("Period name", { exact: true }).fill("Fall 2026");
  await page
    .getByLabel("Period kind", { exact: true })
    .selectOption("semester");
  await page.getByLabel("Period starts", { exact: true }).fill("2026-08-24");
  await page.getByLabel("Period ends", { exact: true }).fill("2026-12-18");
  await page.getByLabel("Period notes", { exact: true }).fill("First semester");
  const periodChecks = page.locator('input[name="classIds"]');
  await periodChecks.nth(0).check();
  await periodChecks.nth(1).check();
  await page
    .getByRole("button", { name: "Save academic period", exact: true })
    .click();
  await page.getByRole("heading", { name: "Fall 2026", exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  const period = snapshot.academicPeriods[0];
  assert.ok(period);
  assert.deepEqual(period.classIds, [ids.physicsId, ids.historyId]);
  assert.equal(period.startsOn, "2026-08-24");

  await page.getByRole("button", { name: "Add space", exact: true }).click();
  await page.getByLabel("Space name", { exact: true }).fill("Main school");
  await page.getByLabel("Space kind", { exact: true }).selectOption("school");
  await page
    .getByLabel("Space notes", { exact: true })
    .fill("Primary workspace");
  const spaceChecks = page.locator('input[name="classIds"]');
  await spaceChecks.nth(0).check();
  await page.getByRole("button", { name: "Save space", exact: true }).click();
  await page
    .getByRole("heading", { name: "Main school", exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  const space = snapshot.spaces[0];
  assert.ok(space);
  assert.deepEqual(space.classIds, [ids.physicsId]);
  await page.screenshot({ path: join(output, "context.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "context-operated.webm"),
    );

  await launch();
  await page
    .getByRole("button", { name: "Academic context", exact: true })
    .click();
  await page.getByRole("heading", { name: "Fall 2026", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Main school", exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.academicPeriods.length, 1);
  assert.equal(snapshot.spaces.length, 1);

  await page
    .getByRole("button", { name: "Forget period", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unlink this academic period" })
    .waitFor();
  await page.getByRole("button", { name: "Forget space", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unlink this space" })
    .waitFor();

  await page.getByRole("button", { name: "Edit period", exact: true }).click();
  const editPeriodChecks = page.locator('input[name="classIds"]');
  await editPeriodChecks.nth(0).uncheck();
  await editPeriodChecks.nth(1).uncheck();
  await page
    .getByRole("button", { name: "Save academic period", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Forget period", exact: true })
    .click();
  await page
    .getByText("No academic periods recorded yet.", { exact: true })
    .waitFor();

  await page.getByRole("button", { name: "Edit space", exact: true }).click();
  const editSpaceChecks = page.locator('input[name="classIds"]');
  await editSpaceChecks.nth(0).uncheck();
  await editSpaceChecks.nth(1).uncheck();
  await page.getByRole("button", { name: "Save space", exact: true }).click();
  await page.getByRole("button", { name: "Forget space", exact: true }).click();
  await page.getByText("No spaces recorded yet.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.academicPeriods.length, 0);
  assert.equal(snapshot.spaces.length, 0);
  assert.equal(snapshot.classes.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Academic context UI records period and space class links, persists across restart, blocks unsafe removal, and forgets safely after unlinking.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
