import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-duration-"));
const output = resolve("artifacts/duration");
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
  // Synthetic historical timing uses the real command boundary and clock injection.
  // It is fixture data, not evidence of three hours of human study.
  const seed = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { DeskStore } from './packages/domain/store.ts';
    const store = new DeskStore(process.env.DESK_FIXTURE_PATH);
    const classId = store.execute({type:'class.create',name:'Physics'}).classes[0].id;
    store.execute({type:'planning.mode',mode:'suggest'});
    store.execute({type:'planning.preferences',input:{studyStart:'00:00',sleepCutoff:'23:59',bufferPercent:15,studyDays:[0,1,2,3,4,5,6]}});
    for (let i=0;i<3;i++) {
      const task = store.execute({type:'task.create',input:{title:'Reviewed problems '+i,classId,minutes:30,dueAt:null,resource:null,notes:'',deadlineConfirmed:true}}).tasks.at(-1);
      const start = new Date('2026-09-01T10:00:00Z');
      start.setUTCDate(start.getUTCDate()+i);
      const session = store.execute({type:'session.start',taskId:task.id},start).sessions.at(-1);
      store.execute({type:'session.end',completed:true},new Date(+start+60*60000));
      store.execute({type:'session.review',id:session.id,notes:'Synthetic fixture',remainingMinutes:null});
    }
    store.close();
  `,
    ],
    {
      env: { ...process.env, DESK_FIXTURE_PATH: join(data, "desk.sqlite") },
      encoding: "utf8",
    },
  );
  assert.equal(seed.status, 0, seed.stderr);
  await launch();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("button", { name: "Enter manually", exact: true })
    .click();
  await page.getByLabel("What needs doing?").fill("Next problem set");
  await page
    .getByRole("button", { name: "Use 60 min estimate", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("Estimated minutes", { exact: true }).inputValue(),
    "30",
  );
  await page
    .getByLabel("Work type", { exact: true })
    .selectOption("assessment");
  assert.equal(
    await page.getByRole("region", { name: "Duration suggestion" }).count(),
    0,
  );
  await page
    .getByLabel("Work type", { exact: true })
    .selectOption("assignment");
  await page
    .getByRole("button", { name: "Use 60 min estimate", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Estimated minutes", { exact: true }).inputValue(),
    "60",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Suggested estimate applied", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).tasks.length,
    3,
  );
  await page.screenshot({ path: join(output, "duration-suggestion.png") });
  await page.getByLabel("I have confirmed").check();
  await page
    .getByRole("button", { name: "Save assignment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Start session →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "End · keep unfinished", exact: true })
    .click();
  await page
    .getByText("60 min estimated remaining when you started.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Add details", exact: true }).click();
  await page.getByLabel("Minutes still needed (optional)").fill("45");
  await page
    .getByLabel("What did you work on")
    .fill("Reviewed the approach; problems remain.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await page
    .getByRole("region", { name: "Session wrap-up" })
    .waitFor({ state: "hidden" });
  const video = page.video();
  await app.close();
  app = undefined;
  if (video)
    await copyFile(await video.path(), join(output, "duration-operated.webm"));
  await launch();
  const state = await page.evaluate(() => window.desk.snapshot());
  const task = state.tasks.find((t) => t.title === "Next problem set");
  assert.equal(task.minutes, 45);
  assert.equal(task.revision, 1);
  const session = state.sessions.find((s) => s.taskId === task.id);
  assert.equal(session.estimateAtStart.minutes, 60);
  assert.equal(session.estimateAtStart.taskRevision, 0);
  assert.equal(session.review.remainingMinutes, 45);
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  const row = page
    .locator("article")
    .filter({ has: page.getByText("Next problem set", { exact: true }) });
  // Locate within the task row when available, otherwise use the unique last history.
  const history = (await row.count())
    ? row.getByText("Study history", { exact: true })
    : page.getByText("Study history", { exact: true }).last();
  await history.click();
  await page
    .getByText("60 min estimated remaining at start", { exact: true })
    .waitFor();
  await page
    .getByText("45 minutes remaining, reported at review", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "duration-history.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: fixture-derived optional suggestion, class/type gating, explicit application, operated session/review, immutable baseline and remaining estimate after restart",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
