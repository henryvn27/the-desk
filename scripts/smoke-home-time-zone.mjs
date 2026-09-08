import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-home-time-zone-"));
const output = resolve("artifacts/home-time-zone");
await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
      TZ: "UTC",
    },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("What are you working on?", { exact: true }).waitFor();

  await page.evaluate(async () => {
    await window.desk.command({
      type: "user.create",
      input: { displayName: "Timezone student", email: null, timeZone: "America/New_York" },
    });
    const createdClass = await window.desk.command({
      type: "class.create",
      name: "AP Physics C",
    });
    const classId = createdClass.classes.at(-1).id;
    await window.desk.command({
      type: "task.create",
      input: {
        title: "Rotational motion review",
        classId,
        dueAt: "2026-09-09T01:00:00.000Z",
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
  });

  await page.reload();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  await page.getByText("Due Tue, Sep 8", { exact: false }).waitFor();
  assert.equal(await page.getByText("Due Tue, Sep 8", { exact: false }).count(), 1);
  await page.screenshot({ path: join(output, "home-profile-zone.png") });
  assert.deepEqual(errors, []);
  console.log("PASS: Home renders a stored deadline in the saved profile zone while the host process runs in UTC.");
} finally {
  if (app) await app.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
