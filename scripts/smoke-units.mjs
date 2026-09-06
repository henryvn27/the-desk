import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-units-ui-"));
const output = resolve("artifacts/units");
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
  await page.getByRole("button", { name: "Units", exact: true }).waitFor();
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
    const physicsId = physics.classes.at(-1).id;
    const historyId = history.classes.at(-1).id;
    const task = await window.desk.command({
      type: "task.create",
      input: {
        title: "Kinematics worksheet",
        classId: physicsId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    return { physicsId, historyId, taskId: task.tasks.at(-1).id };
  });

  await page.getByRole("button", { name: "Units", exact: true }).click();
  await page
    .getByRole("heading", { name: "Units & tracks", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Add track", exact: true }).click();
  await page
    .getByLabel("Track class", { exact: true })
    .selectOption(ids.physicsId);
  await page.getByLabel("Track name", { exact: true }).fill("Mechanics");
  await page
    .getByLabel("Track notes", { exact: true })
    .fill("Core motion and forces");
  await page.getByRole("button", { name: "Save track", exact: true }).click();
  await page.getByRole("heading", { name: "Mechanics", exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  const track = snapshot.tracks[0];
  assert.ok(track);

  await page
    .getByRole("button", { name: "Add unit / module", exact: true })
    .click();
  await page
    .getByLabel("Unit class", { exact: true })
    .selectOption(ids.physicsId);
  await page.getByLabel("Unit track", { exact: true }).selectOption(track.id);
  await page.getByLabel("Unit name", { exact: true }).fill("Kinematics");
  await page.getByLabel("Unit kind", { exact: true }).selectOption("unit");
  await page.getByLabel("Unit sequence", { exact: true }).fill("1");
  await page.getByLabel("Unit tasks", { exact: true }).selectOption(ids.taskId);
  await page
    .getByLabel("Unit notes", { exact: true })
    .fill("Vectors and motion");
  await page.getByRole("button", { name: "Save unit", exact: true }).click();
  await page.getByText("Kinematics", { exact: false }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tracks.length, 1);
  assert.equal(snapshot.units.length, 1);
  assert.deepEqual(snapshot.units[0].taskIds, [ids.taskId]);
  assert.equal(snapshot.units[0].trackId, track.id);
  assert.equal(snapshot.units[0].classId, ids.physicsId);
  assert.equal(snapshot.units[0].notes, "Vectors and motion");
  await page.screenshot({ path: join(output, "units.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "units-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Units", exact: true }).click();
  await page.getByText("Kinematics", { exact: false }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.units.length, 1);
  assert.equal(snapshot.tracks.length, 1);

  await page.getByRole("button", { name: "Forget track", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "units" }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tracks.length, 1);
  assert.equal(snapshot.units.length, 1);

  await page.getByRole("button", { name: "Forget unit", exact: true }).click();
  await page.getByRole("heading", { name: "Mechanics", exact: true }).waitFor();
  await page.getByRole("button", { name: "Forget track", exact: true }).click();
  await page
    .getByText("No tracks or units recorded yet.", { exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tracks.length, 0);
  assert.equal(snapshot.units.length, 0);
  assert.equal(snapshot.classes.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Units UI records explicit class hierarchy, links tracks to units and tasks, persists across restart, blocks unsafe track removal, and forgets safely.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
