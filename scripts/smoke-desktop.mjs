import { _electron as electron } from "playwright";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-ui-"));
const output = resolve("artifacts/smoke");
await mkdir(output, { recursive: true });
let desktop;
let page;
const errors = [];
async function launch() {
  desktop = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data },
    recordVideo: { dir: output },
  });
  await desktop.firstWindow();
  for (let attempt = 0; attempt < 100; attempt++) {
    page = desktop.windows().find((w) => w.url().endsWith("#main"));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(page, "Main Desk window opened");
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByText("Make room for focus.").waitFor();
}
try {
  await launch();
  await page.getByLabel("Class name", { exact: true }).fill("AP Physics C");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page
    .getByRole("button", { name: "AP Physics C", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Capture assignment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await page
    .getByLabel("What needs doing?")
    .fill("Work through friction problems 8–14");
  await page.getByLabel("Estimated minutes").fill("45");
  await page.getByLabel("I have confirmed").check();
  await page.getByRole("button", { name: "Save assignment" }).click();
  await page.getByRole("button", { name: "Start session →" }).waitFor();
  await page.screenshot({ path: join(output, "home.png") });
  await page.getByRole("button", { name: "Start session →" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  let snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.sessions.filter((s) => !s.endedAt).length, 1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await desktop.close();
  await launch();
  await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Lens", exact: true }).click();
  let lens;
  for (let attempt = 0; attempt < 100; attempt++) {
    lens = desktop.windows().find((w) => w.url().endsWith("#lens"));
    if (lens) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(lens, "Lens window opened");
  await lens.getByLabel("Draw a freehand selection", { exact: true }).waitFor();
  await lens.mouse.move(200, 200);
  await lens.mouse.down();
  for (let angle = 0; angle <= Math.PI * 2; angle += 0.2)
    await lens.mouse.move(
      250 + 80 * Math.cos(angle),
      250 + 60 * Math.sin(angle),
    );
  await lens.mouse.up();
  const drawnPaths = lens.locator("svg > path");
  if ((await drawnPaths.count()) !== 1) {
    console.log(
      await drawnPaths.evaluateAll((xs) =>
        xs.map((x) => ({
          d: x.getAttribute("d"),
          parent: x.parentElement?.outerHTML.slice(0, 200),
        })),
      ),
    );
    await lens.screenshot({ path: join(output, "lens-failure.png") });
  }
  assert.equal(await drawnPaths.count(), 1);
  await lens
    .getByLabel("Ask The Desk", { exact: true })
    .fill("Why does friction point this way?");
  await lens.getByRole("button", { name: "Ask", exact: true }).click();
  await lens
    .getByText("Connect an AI provider in Settings first.", { exact: true })
    .waitFor();
  await lens.screenshot({ path: join(output, "lens-selection.png") });
  await lens.getByRole("button", { name: "Dismiss · Esc" }).click();
  await page.getByRole("button", { name: "Finish task", exact: true }).click();
  await page.getByRole("button", { name: "Looks right", exact: true }).click();
  await page.getByText("Ready when you are.", { exact: true }).waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tasks[0].completed, true);
  assert.ok(snapshot.sessions[0].endedAt);
  await desktop.close();
  await launch();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tasks[0].completed, true);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const original = "AP Physics C: Friction review due 2026-09-09, 30 minutes";
  await page
    .getByLabel("Paste an assignment or a few clear assignment lines")
    .fill(original);
  await page
    .getByRole("button", { name: "Interpret text", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Due date", { exact: true }).inputValue(),
    "2026-09-09",
  );
  assert.equal(
    await page.getByLabel("Due time (local)", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("I have confirmed").check();
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page
    .getByText(
      "Choose a due time to confirm this date. Desk will not invent one.",
      { exact: true },
    )
    .waitFor();
  await page.getByLabel("Due time (local)", { exact: true }).fill("23:59");
  await page.screenshot({ path: join(output, "capture-review.png") });
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.locator("dialog").waitFor({ state: "detached" });
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tasks.at(-1).captureEvidence.originalText, original);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Start session →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "End · keep unfinished", exact: true })
    .click();
  await page.getByRole("button", { name: "Add details", exact: true }).click();
  await page
    .getByLabel("What did you work on, or what needs another look?")
    .fill("Reviewed free-body diagrams; revisit friction direction.");
  await page.getByLabel("Minutes still needed (optional)").fill("20");
  await page.screenshot({ path: join(output, "session-review.png") });
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page
    .getByRole("region", { name: "Session wrap-up" })
    .waitFor({ state: "detached" });
  await desktop.close();
  await page.video().saveAs(join(output, "session-review.webm"));
  await launch();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.tasks.at(-1).minutes, 20);
  assert.equal(snapshot.tasks.at(-1).completed, false);
  assert.equal(
    snapshot.sessions.at(-1).review.notes,
    "Reviewed free-body diagrams; revisit friction direction.",
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByText("Study history", { exact: true }).last().click();
  await page
    .getByText("Reviewed free-body diagrams; revisit friction direction.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    snapshot.tasks.at(-1).dueAt,
    new Date("2026-09-09T23:59").toISOString(),
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .locator("article")
    .filter({ hasText: "AP Physics C: Friction review" })
    .getByRole("button", { name: "Edit assignment", exact: true })
    .click();
  await page.getByLabel("Due date", { exact: true }).fill("2026-09-10");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Approve the change to this confirmed deadline before saving.", {
      exact: true,
    })
    .waitFor();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(
    snapshot.tasks.at(-1).dueAt,
    new Date("2026-09-09T23:59").toISOString(),
  );
  await page
    .getByLabel("Approve any change to the confirmed deadline", { exact: true })
    .check();
  await page.screenshot({ path: join(output, "task-edit.png") });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.locator("dialog").waitFor({ state: "detached" });
  await desktop.close();
  await launch();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(
    snapshot.tasks.at(-1).dueAt,
    new Date("2026-09-10T23:59").toISOString(),
  );
  assert.equal(snapshot.tasks.at(-1).captureEvidence.originalText, original);
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Study starts at", { exact: true }).fill("16:00");
  await page.getByLabel("Sleep cutoff", { exact: true }).fill("21:00");
  for (const day of [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ])
    await page.getByLabel(day, { exact: true }).uncheck();
  await page.getByLabel("Unscheduled buffer (%)", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "Save study preferences", exact: true })
    .click();
  await page.getByText("Study preferences saved.", { exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Settings", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "planning-settings.png") });
  await desktop.close();
  await page.video().saveAs(join(output, "planning-settings.webm"));
  await launch();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.deepEqual(snapshot.planning, {
    studyStart: "16:00",
    sleepCutoff: "21:00",
    studyDays: [],
    bufferPercent: 20,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "Start session →", exact: true })
      .count(),
    0,
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Study starts at", { exact: true }).fill("09:00");
  await page.getByLabel("Sleep cutoff", { exact: true }).fill("10:00");
  for (const day of [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ])
    await page.getByLabel(day, { exact: true }).check();
  await page
    .getByRole("button", { name: "Save study preferences", exact: true })
    .click();
  await page.getByText("Study preferences saved.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await page.getByLabel("What needs doing?").fill("Long practice packet");
  await page.getByLabel("Estimated minutes").fill("180");
  await page.getByLabel("I have confirmed").check();
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("heading", { name: "Your plan", exact: true }).waitFor();
  assert.ok(
    (await page
      .locator("section.row")
      .filter({ hasText: "Long practice packet" })
      .count()) > 1,
  );
  await page.screenshot({ path: join(output, "weekly-plan.png") });
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page
    .getByRole("button", { name: "Save text source", exact: true })
    .click();
  await page
    .getByLabel("Source title", { exact: true })
    .fill("Vector reference");
  const passage =
    "  Resolve a vector into perpendicular components.\nα = 30°\n";
  await page.getByLabel("Original text", { exact: true }).fill(passage);
  await page
    .getByText("Link classes and assignments (optional)", { exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("AP Physics C", { exact: true })
    .check();
  await page
    .getByRole("dialog")
    .getByLabel("Long practice packet", { exact: true })
    .check();
  await page.getByRole("button", { name: "Save source", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page
    .getByLabel("Search tasks, notes and sources", { exact: true })
    .fill("perpendicular");
  await page.getByText("Vector reference", { exact: true }).click();
  await page.screenshot({ path: join(output, "source-library.png") });
  await desktop.close();
  await page.video().saveAs(join(output, "source-library.webm"));
  await launch();
  snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.sources[0].text, passage);
  assert.equal(snapshot.sources[0].taskIds[0], snapshot.tasks.at(-1).id);
  assert.equal(snapshot.sources[0].classIds[0], snapshot.classes[0].id);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        flows: [
          "class capture",
          "task capture",
          "Home Next",
          "session start",
          "pause restart resume",
          "Lens freehand selection and dismiss",
          "explicit completion",
          "completed restart",
          "pasted-text review with no invented due time and persisted provenance",
          "confirmed deadline edit requires approval and survives restart",
          "session review notes and remaining work survive restart and appear in history",
          "study preferences survive restart and off-days have no automatic study blocks",
          "long assignment splits across future study days in Plan",
          "text source capture, assignment link, content search and exact-text restart persistence",
        ],
        limitations: [
          process.env.DESK_EXECUTABLE
            ? "installed development package, unsigned"
            : "development executable, not installed package",
          "no AI, voice or captured-screen interpretation",
          "no external resource in this smoke",
          "not full V1 acceptance",
        ],
        artifacts: output,
      },
      null,
      2,
    ),
  );
} finally {
  if (desktop) await desktop.close().catch(() => {});
  await rm(data, { recursive: true, force: true });
}
