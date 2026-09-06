import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-user-ui-"));
const output = resolve("artifacts/user");
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
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

try {
  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Add local profile", exact: true })
    .click();
  await page.getByLabel("Display name", { exact: true }).fill("Henry");
  await page
    .getByLabel("Profile email", { exact: true })
    .fill("henry@example.edu");
  await page
    .getByLabel("Profile time zone", { exact: true })
    .fill("America/New_York");
  await page
    .getByRole("button", { name: "Save local profile", exact: true })
    .click();
  await page.getByText("Local profile saved.", { exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.user.displayName, "Henry");
  assert.equal(snapshot.user.timeZone, "America/New_York");
  const userId = snapshot.user.id;
  await page.screenshot({ path: join(output, "user.png") });
  const firstVideo = page.video();
  await app.close();
  app = undefined;
  if (firstVideo)
    await copyFile(await firstVideo.path(), join(output, "user-operated.webm"));

  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Henry V.");
  await page.getByLabel("Profile time zone", { exact: true }).fill("UTC");
  await page
    .getByRole("button", { name: "Save local profile", exact: true })
    .click();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.user.id, userId);
  assert.equal(snapshot.user.revision, 1);
  assert.equal(snapshot.user.displayName, "Henry V.");
  await page
    .getByRole("button", { name: "Forget local profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add local profile", exact: true })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.user, null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local user profile creates, persists across restart, updates by revision, and forgets without touching academic data.",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
