import { _electron as electron } from "playwright";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "desk-packaged-provider-"));
const output = resolve("artifacts/provider");
await mkdir(output, { recursive: true });
let app;

try {
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env: {
      ...process.env,
      DESK_DATA_DIR: data,
      DESK_TEST_BACKGROUND: "1",
      // Packaged builds must not read a developer key from the repository.
      DESK_ENABLE_DEVELOPMENT_KEY: "0",
    },
  });
  const page = await app.firstWindow();
  await page.getByText("What are you working on?", { exact: true }).waitFor();
  const status = await page.evaluate(() => window.desk.providerStatus());
  assert.equal(status.selectedProvider, "desk-managed");
  assert.equal(await page.evaluate(() => document.body.innerText.includes("sk-or-v1-")), false);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  if (status.availability === "offline") {
    await page.getByText("Managed AI is not connected in this build.", { exact: true }).waitFor();
    await page.getByText("Desk AI is unavailable right now. Your local workspace still works.", { exact: true }).waitFor();
  }
  await page.screenshot({ path: join(output, "packaged-provider-state.png") });
  console.log(JSON.stringify({
    result: "PASS",
    selectedProvider: status.selectedProvider,
    availability: status.availability,
    source: status.source,
    rendererContainsCredential: false,
  }));
} finally {
  if (app) await app.close();
  await rm(data, { recursive: true, force: true });
}
