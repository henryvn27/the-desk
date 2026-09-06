import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-authority-ui-"));
const output = resolve("artifacts/authority");
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
  await page.getByRole("button", { name: "Authority", exact: true }).waitFor();
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
        title: "Friction lab",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: false,
      },
    });
    return { classId, taskId: createdTask.tasks.at(-1).id };
  });

  await page.getByRole("button", { name: "Authority", exact: true }).click();
  await page
    .getByRole("heading", { name: "Authority & conflicts", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Add due-date claim", exact: true })
    .click();
  await page
    .getByLabel("Claim class", { exact: true })
    .selectOption(ids.classId);
  await page
    .getByLabel("Claim assignment", { exact: true })
    .selectOption(ids.taskId);
  await page
    .getByLabel("Authority class", { exact: true })
    .selectOption("syllabus");
  await page
    .getByLabel("Reported due date", { exact: true })
    .fill("2026-09-09T23:00");
  await page
    .getByLabel("Claim confidence", { exact: true })
    .selectOption("high");
  await page.getByLabel("Claim source label", { exact: true }).fill("Syllabus");
  await page.getByLabel("Claim details", { exact: true }).fill("Wednesday");
  await page.getByRole("button", { name: "Save claim", exact: true }).click();
  await page.getByText("Syllabus", { exact: true }).waitFor();

  await page
    .getByRole("button", { name: "Add due-date claim", exact: true })
    .click();
  await page
    .getByLabel("Claim assignment", { exact: true })
    .selectOption(ids.taskId);
  await page
    .getByLabel("Authority class", { exact: true })
    .selectOption("live-lms");
  await page
    .getByLabel("Reported due date", { exact: true })
    .fill("2026-09-08T23:00");
  await page
    .getByLabel("Claim confidence", { exact: true })
    .selectOption("medium");
  await page
    .getByLabel("Claim source label", { exact: true })
    .fill("Classroom");
  await page.getByLabel("Claim details", { exact: true }).fill("Tuesday");
  await page.getByRole("button", { name: "Save claim", exact: true }).click();
  await page
    .getByText("Conflicting due dates are preserved.", { exact: false })
    .waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.authorityClaims.length, 2);
  assert.equal(snapshot.tasks[0].dueAt, null);

  await page
    .getByRole("button", { name: "Use this due date", exact: true })
    .first()
    .click();
  await page.getByRole("status").waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tasks[0].dueAt, "2026-09-08T23:00:00.000Z");
  assert.equal(
    snapshot.authorityResolutions[0].claimId,
    snapshot.authorityClaims[1].id,
  );
  await page.screenshot({ path: join(output, "authority.png") });

  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "authority-operated.webm"),
    );

  await launch();
  await page.getByRole("button", { name: "Authority", exact: true }).click();
  await page
    .getByText("Conflicting due dates are preserved.", { exact: false })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.authorityClaims.length, 2);
  assert.equal(snapshot.authorityResolutions.length, 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Authority claims preserve competing due dates, require an explicit resolution, and persist the chosen claim across restart.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
