import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-kit-"));
const output = resolve("artifacts/session-kit");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data, TZ: "UTC" },
    recordVideo: { dir: output },
  });
  // Assert trusted dispatch without changing the user's browser state.
  await app.evaluate(({ shell }) => {
    globalThis.kitOpened = [];
    shell.openExternal = async (url) => {
      globalThis.kitOpened.push(url);
    };
  });
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((p) => p.url().endsWith("#main"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Home", exact: true }).waitFor();
}
try {
  await launch();
  // Only setup/preferences and explicit source associations are seeded through IPC.
  await page.evaluate(async () => {
    await window.desk.command({ type: "planning.mode", mode: "suggest" });
    await window.desk.command({
      type: "planning.preferences",
      input: {
        studyStart: "00:00",
        sleepCutoff: "23:59",
        studyDays: [0, 1, 2, 3, 4, 5, 6],
        bufferPercent: 15,
      },
    });
  });
  await page.getByLabel("Class name", { exact: true }).fill("Physics");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).waitFor();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await page.getByLabel("What needs doing?").fill("Vectors practice");
  await page.getByLabel("I have confirmed").check();
  await page.getByText("Source and resource", { exact: true }).click();
  await page
    .getByLabel("Resource link", { exact: true })
    .fill("https://example.com/vectors");
  await page
    .getByLabel("Original text or notes", { exact: true })
    .fill("Work through components before adding vectors.");
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.evaluate(async () => {
    const state = await window.desk.snapshot();
    const task = state.tasks[0];
    await window.desk.command({
      type: "source.create",
      input: {
        title: "Vector worksheet",
        text: "Draw the components for each vector.",
        classIds: [task.classId],
        taskIds: [task.id],
      },
    });
    await window.desk.command({
      type: "source.create",
      input: {
        title: "Physics reference",
        text: "Keep units consistent.",
        classIds: [task.classId],
        taskIds: [],
      },
    });
    const other = (
      await window.desk.command({
        type: "task.create",
        input: {
          title: "Unrelated lab",
          classId: task.classId,
          minutes: 30,
          dueAt: null,
          deadlineConfirmed: false,
          notes: "",
          resource: null,
        },
      })
    ).tasks.at(-1);
    await window.desk.command({
      type: "source.create",
      input: {
        title: "Other lab source",
        text: "Do not include this in the vector kit.",
        classIds: [task.classId],
        taskIds: [other.id],
      },
    });
  });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByText("Preview study materials", { exact: true }).click();
  const kit = page.getByRole("region", { name: "Session kit", exact: true });
  await kit.getByText("Vector worksheet", { exact: true }).waitFor();
  assert.equal(
    await kit.getByText("Other lab source", { exact: true }).count(),
    0,
  );
  await kit
    .getByRole("button", { name: "Open assignment resource", exact: true })
    .click();
  assert.deepEqual(await app.evaluate(() => globalThis.kitOpened), [
    "https://example.com/vectors",
  ]);
  await page
    .getByRole("button", { name: "Start session →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "End · keep unfinished", exact: true })
    .click();
  await page.getByRole("button", { name: "Add details", exact: true }).click();
  await page
    .getByLabel("What did you work on")
    .fill("Double-check the negative horizontal component.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page
    .getByRole("region", { name: "Session wrap-up" })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Start session →", exact: true })
    .click();
  await kit.getByText("Assignment notes", { exact: true }).click();
  await kit.getByText("Vector worksheet", { exact: true }).click();
  await kit.getByText("Class reference (1)", { exact: true }).click();
  await kit.getByText("Physics reference", { exact: true }).click();
  await kit
    .locator("summary")
    .filter({ hasText: /min tracked$/ })
    .click();
  await kit
    .getByText("Double-check the negative horizontal component.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await page
    .locator("section.session")
    .screenshot({ path: join(output, "session-kit.png") });
  assert.deepEqual(
    await app.evaluate(() => globalThis.kitOpened),
    Array(3).fill("https://example.com/vectors"),
  );
  const video = page.video();
  await app.close();
  app = undefined;
  if (video)
    await copyFile(
      await video.path(),
      join(output, "session-kit-operated.webm"),
    );
  await launch();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  const restored = page.getByRole("region", {
    name: "Session kit",
    exact: true,
  });
  await restored.getByText("Vector worksheet", { exact: true }).waitFor();
  await restored
    .locator("summary")
    .filter({ hasText: /min tracked$/ })
    .click();
  await restored
    .getByText("Double-check the negative horizontal component.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await restored.getByText("Other lab source", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: kit preview and active display, explicit task/class association, prior UI review, resource dispatch stub, paused restart persistence",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
