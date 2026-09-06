import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { waitFor } from "./wait-for.mjs";
const data = await mkdtemp(join(tmpdir(), "desk-checklist-"));
const output = resolve("artifacts/checklist");
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
  await page.getByLabel("What needs doing?").fill("Resolve vectors");
  await page.getByLabel("I have confirmed").check();
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByText("Preview study materials", { exact: true }).click();
  const checklist = page.getByRole("region", {
    name: "Assignment checklist",
    exact: true,
  });
  for (const title of ["Draw diagram", "Resolve components"]) {
    await checklist.getByLabel("Add a step", { exact: true }).fill(title);
    await checklist
      .getByRole("button", { name: "Add step", exact: true })
      .click();
    await checklist.getByLabel(title, { exact: true }).waitFor();
  }
  const first = checklist
    .locator("li")
    .filter({ has: page.getByLabel("Draw diagram", { exact: true }) });
  await first
    .getByRole("button", { name: "Archive step", exact: true })
    .click();
  await checklist.getByText("Archived steps", { exact: true }).click();
  await checklist
    .getByRole("button", { name: "Restore step", exact: true })
    .click();
  await checklist
    .getByText("Archived steps", { exact: true })
    .waitFor({ state: "hidden" });
  await checklist.getByLabel("Draw diagram", { exact: true }).click();
  await waitFor(
    () => checklist.getByLabel("Draw diagram", { exact: true }).isChecked(),
    "Checklist update did not persist",
  );
  await checklist
    .getByText("Checklist · 1 of 2 checked", { exact: true })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).tasks[0].completed,
    false,
  );
  await page
    .getByRole("button", { name: "Start session →", exact: true })
    .click();
  await page
    .getByText("1 of 2 steps checked · Next step: Resolve components", {
      exact: true,
    })
    .waitFor();
  let controller;
  await waitFor(
    () =>
      Boolean(
        (controller = app
          .windows()
          .find((p) => p.url().endsWith("#controller"))),
      ),
    "Controller did not open",
  );
  await controller.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await page
    .locator("section.session")
    .screenshot({ path: join(output, "checklist-progress.png") });
  const bounds = await controller.evaluate(() => ({
    height: innerHeight,
    content: document.documentElement.scrollHeight,
  }));
  assert.ok(
    bounds.content <= bounds.height,
    "Controller content must fit without scrolling",
  );
  await controller.screenshot({
    path: join(output, "checklist-controller.png"),
  });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video)
    await copyFile(await video.path(), join(output, "checklist-operated.webm"));
  await launch();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Draw diagram", { exact: true }).isChecked(),
    true,
  );
  await page
    .getByRole("button", { name: "End · keep unfinished", exact: true })
    .click();
  await page
    .getByText("1 of 2 steps were checked when this session ended.", {
      exact: true,
    })
    .waitFor();
  const ended = (await page.evaluate(() => window.desk.snapshot())).sessions[0];
  await page.getByRole("button", { name: "Looks right", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page.getByText("Assignment checklist", { exact: true }).click();
  const item = page
    .getByRole("region", { name: "Assignment checklist", exact: true })
    .locator("li")
    .filter({ has: page.getByLabel("Draw diagram", { exact: true }) });
  await item.getByRole("button", { name: "Edit step", exact: true }).click();
  await page
    .getByLabel("Step name", { exact: true })
    .fill("Draw free-body diagram");
  await page.getByRole("button", { name: "Save step", exact: true }).click();
  await page.getByLabel("Draw free-body diagram", { exact: true }).waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.desk.snapshot())).sessions[0]
      .checklistAtEnd,
    ended.checklistAtEnd,
  );
  await page.getByText("Study history", { exact: true }).click();
  await page.getByText("Checklist at session end", { exact: true }).click();
  await page.getByText("Checked · Draw diagram", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: UI checklist add/check/archive/restore, next unchecked step, paused restart, end snapshot and later rename preserving history",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
