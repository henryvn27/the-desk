import { _electron as electron } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const data = await mkdtemp(join(tmpdir(), "desk-grades-"));
const output = resolve("artifacts/grades");
await mkdir(output, { recursive: true });
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: { ...process.env, DESK_DATA_DIR: data },
    recordVideo: { dir: output },
  });
  for (let i = 0; i < 100; i++) {
    page = app.windows().find((p) => p.url().endsWith("#main"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("button", { name: "Plan", exact: true }).waitFor();
}
try {
  await launch();
  await page.getByLabel("Class name", { exact: true }).fill("Physics");
  await page.getByRole("button", { name: "Add class", exact: true }).click();
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page.getByText("Gradebook", { exact: true }).click();
  await page.getByLabel("Category name", { exact: true }).fill("Tests");
  await page.getByLabel("Category weight (%)", { exact: true }).fill("80");
  await page
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await page.getByLabel("Score title", { exact: true }).waitFor();
  await page.getByLabel("Category name", { exact: true }).fill("Assignments");
  await page.getByLabel("Category weight (%)", { exact: true }).fill("21");
  await page
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await page
    .getByText("Category weights cannot exceed 100%.", { exact: false })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).gradeCategories.length,
    1,
  );
  await page.getByLabel("Category weight (%)", { exact: true }).fill("20");
  await page
    .getByRole("button", { name: "Save category", exact: true })
    .click();
  await page.getByText("Assignments", { exact: true }).first().waitFor();
  await page
    .getByLabel("Score title", { exact: true })
    .fill("Forces assessment");
  await page
    .getByLabel("Score category", { exact: true })
    .selectOption({ label: "Tests" });
  await page.getByLabel("Earned points", { exact: true }).fill("8");
  await page.getByLabel("Possible points", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Save score", exact: true }).click();
  await page.getByText("64.0–84.0%", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Correct score", exact: true })
    .click();
  await page.getByLabel("Earned points", { exact: true }).fill("9");
  await page.getByRole("button", { name: "Save score", exact: true }).click();
  await page.getByText("72.0–92.0%", { exact: true }).waitFor();
  const saved = await page.evaluate(() => window.desk.snapshot());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(output, "gradebook.png") });
  await app.close();
  app = undefined;
  await launch();
  await page.getByRole("button", { name: "Physics", exact: true }).click();
  await page.getByText("Gradebook", { exact: true }).click();
  await page.getByText("72.0–92.0%", { exact: true }).waitFor();
  const restored = await page.evaluate(() => window.desk.snapshot());
  assert.deepEqual(restored.gradeCategories, saved.gradeCategories);
  assert.deepEqual(restored.gradeEntries, saved.gradeEntries);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: weighted categories, rejection above 100%, score correction, range assumptions and restart persistence",
  );
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
