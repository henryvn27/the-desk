import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-mistakes-ui-"));
const output = resolve("artifacts/mistakes");
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
  await page.getByRole("button", { name: "Mistakes", exact: true }).waitFor();
}

try {
  await launch();
  const ids = await page.evaluate(async () => {
    const createdClass = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const classId = createdClass.classes.at(-1).id;
    const createdTask = await window.desk.command({
      type: "task.create",
      input: {
        title: "Friction worksheet",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "Resolve components before adding forces.",
        deadlineConfirmed: true,
      },
    });
    return { classId, taskId: createdTask.tasks.at(-1).id };
  });

  await page.getByRole("button", { name: "Mistakes", exact: true }).click();
  await page.getByRole("heading", { name: "Mistakes", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Record a mistake", exact: true })
    .click();
  await page
    .getByLabel("Mistake class", { exact: true })
    .selectOption(ids.classId);
  await page
    .getByLabel("Mistake assignment", { exact: true })
    .selectOption(ids.taskId);
  await page.getByLabel("Concept", { exact: true }).fill("Friction");
  await page.getByLabel("Source", { exact: true }).fill("Worksheet 4 #7");
  await page
    .getByLabel("Original attempt", { exact: true })
    .fill("I added the forces without resolving components.");
  await page
    .getByLabel("What went wrong", { exact: true })
    .fill("The horizontal and vertical components were mixed.");
  await page
    .getByLabel("Correction", { exact: true })
    .fill("Resolve each force into components before adding them.");
  await page.getByLabel("Help used", { exact: true }).fill("Teacher feedback");
  await page
    .getByLabel("Mistake confidence", { exact: true })
    .selectOption("medium");
  await page.getByRole("button", { name: "Save mistake", exact: true }).click();
  await page.getByText("Friction", { exact: true }).waitFor();

  let snapshot = await page.evaluate(() => window.desk.snapshot());
  let mistake = snapshot.mistakes[0];
  assert.equal(mistake.classId, ids.classId);
  assert.equal(mistake.taskId, ids.taskId);
  assert.equal(mistake.source, "Worksheet 4 #7");
  assert.equal(mistake.originalAttempt.includes("resolving"), true);
  assert.equal(mistake.whatWentWrong.includes("components"), true);
  assert.equal(mistake.correction.includes("Resolve"), true);
  assert.equal(mistake.helpUsed, "Teacher feedback");
  assert.equal(mistake.confidence, "medium");
  assert.equal(mistake.revision, 0);

  await page.getByRole("button", { name: "Edit mistake", exact: true }).click();
  await page
    .getByLabel("Correction", { exact: true })
    .fill("Resolve each force into x and y components first.");
  await page.getByRole("button", { name: "Save mistake", exact: true }).click();
  await page
    .getByText(
      "Correction: Resolve each force into x and y components first.",
      {
        exact: true,
      },
    )
    .waitFor();

  snapshot = await page.evaluate(() => window.desk.snapshot());
  mistake = snapshot.mistakes[0];
  assert.equal(mistake.revision, 1);
  assert.equal(mistake.correction.includes("x and y"), true);

  await page
    .getByRole("button", { name: "Generate practice", exact: true })
    .click();
  await page
    .getByText("Practice tasks: Practice: Friction", { exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  mistake = snapshot.mistakes[0];
  assert.equal(mistake.revision, 2);
  assert.equal(mistake.practiceTaskIds.length, 1);
  const practice = snapshot.tasks.find(
    (task) => task.id === mistake.practiceTaskIds[0],
  );
  assert.ok(practice);
  assert.equal(practice.title, "Practice: Friction");
  assert.match(practice.notes, /Correction:/);
  await page.screenshot({ path: join(output, "mistakes.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "mistakes-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Mistakes", exact: true }).click();
  await page
    .getByText("Practice tasks: Practice: Friction", { exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.mistakes.length, 1);
  assert.equal(snapshot.mistakes[0].practiceTaskIds.length, 1);
  assert.equal(snapshot.tasks.length, 2);

  await page
    .getByRole("button", { name: "Forget mistake", exact: true })
    .click();
  await page.getByText("No mistakes recorded yet.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.mistakes.length, 0);
  assert.equal(snapshot.tasks.length, 2);

  await app.close();
  app = undefined;
  await launch();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.mistakes.length, 0);
  assert.equal(snapshot.tasks.length, 2);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Mistakes UI records all fields, edits by revision, generates practice, persists across restart, and forgets only the mistake.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
