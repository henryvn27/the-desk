import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { closeElectron } from "./close-electron.mjs";
import { waitFor } from "./wait-for.mjs";

const data = await mkdtemp(join(tmpdir(), "desk-browser-bridge-"));
const output = resolve("artifacts/browser-bridge");
await mkdir(output, { recursive: true });
const errors = [];
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
  app.on("window", (page) => {
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
    });
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  const status = await page.evaluate(() => window.desk.browserBridgeStatus());
  assert.equal(status.running, true);
  assert.match(status.endpoint ?? "", /^http:\/\/127\.0\.0\.1:\d+\/v1\/browser\/context$/);
  assert.ok(status.token);
  assert.equal(/sk-or-v1-|sb_secret_/.test(status.token), false);

  const message = {
    version: 1,
    requestId: "00000000-0000-4000-8000-000000000123",
    type: "page-context",
    context: {
      browser: "chrome",
      tabId: "smoke-tab",
      url: "https://classroom.google.com/c/physics",
      title: "Physics assignment",
      selectionText: "Resolve the force diagram.",
      visibleText: "Use the class handout and show each component.",
      capturedAt: new Date().toISOString(),
      adapter: "classroom",
    },
  };
  const accepted = await fetch(status.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${status.token}`,
      origin: "chrome-extension://desk-test",
      "content-type": "application/json",
      "x-desk-bridge-version": "1",
    },
    body: JSON.stringify(message),
  });
  assert.equal(accepted.status, 202);
  await page.getByText("Browser context ready", { exact: true }).waitFor();
  await page.getByText("Physics assignment", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.desk.browserContext()), message);
  await page.screenshot({ path: join(output, "browser-context-ready.png") });

  const rejected = await fetch(status.endpoint, {
    method: "POST",
    headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  assert.equal(rejected.status, 401);
  const malformed = await fetch(status.endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${status.token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...message, command: "execute" }),
  });
  assert.equal(malformed.status, 400);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByText("Browser context ready", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.desk.browserContext()), null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: installed loopback bridge accepts a reviewed page-context envelope, rejects bad authorization/data, updates Desk state, and clears without renderer errors.",
  );
} finally {
  if (app) await closeElectron(app);
  await rm(data, { recursive: true, force: true });
}
