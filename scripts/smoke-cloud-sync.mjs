import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { closeElectron } from "./close-electron.mjs";

const data = await mkdtemp(join(tmpdir(), "desk-cloud-sync-"));
const output = resolve("artifacts/cloud-sync");
await mkdir(output, { recursive: true });
const requests = [];
const remote = [];
const authGrants = [];
const syncTokens = [];
let refreshCount = 0;
let refreshMode = "success";
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url });
  if (request.url?.startsWith("/auth/v1/token")) {
    const grant = new URL(request.url, "http://127.0.0.1").searchParams.get("grant_type");
    authGrants.push(grant);
    const refresh = grant === "refresh_token";
    if (refresh) refreshCount += 1;
    if (refresh && refreshMode === "transient") {
      response.writeHead(503).end();
      return;
    }
    if (refresh && refreshMode === "invalid") {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: refresh ? `cloud-refresh-access-${refreshCount}` : "cloud-access-token",
        refresh_token: refresh ? `cloud-refresh-token-${refreshCount}` : "cloud-refresh-token",
        // Keep the fixture short-lived so the trusted refresh path is exercised
        // on the next local operation and after an app restart.
        expires_in: 1,
        user: {
          id: "00000000-0000-4000-8000-000000000010",
          email: JSON.parse(body).email,
        },
      }),
    );
    return;
  }
  if (request.url === "/auth/v1/logout") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
    return;
  }
  if (request.url?.startsWith("/rest/v1/desk_sync_operations")) {
    if (request.headers.authorization) syncTokens.push(request.headers.authorization);
    if (request.method === "GET") {
      const query = new URL(request.url, "http://127.0.0.1").searchParams;
      const entityFilter = query.get("entity_id")?.replace(/^eq\./, "");
      const matches = remote
        .filter((item) => !entityFilter || item.entity_id === entityFilter)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 1);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(matches));
      return;
    }
    if (request.method === "POST") {
      remote.push(JSON.parse(body));
      response.writeHead(201);
      response.end();
      return;
    }
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const address = server.address();
assert.ok(address && typeof address === "object");
const supabaseUrl = `http://127.0.0.1:${address.port}`;
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
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      TZ: "UTC",
    },
    recordVideo: { dir: output },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    page = app.windows().find((window) => window.url().endsWith("#main"));
    if (page) break;
    await new Promise((resolvePage) => setTimeout(resolvePage, 50));
  }
  assert.ok(page, "Main Desk window opened");
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw Error(message);
}

try {
  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("heading", { name: "Desk account", exact: true }).waitFor();
  await page.getByLabel("Account email", { exact: true }).fill("student@example.edu");
  await page.getByLabel("Password", { exact: true }).fill("long-enough-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByText("Signed in to the Desk account.", { exact: true }).waitFor();
  const created = await page.evaluate(() =>
    window.desk.command({ type: "class.create", name: "Cloud Physics" }),
  );
  const classId = created.classes.at(-1)?.id;
  assert.ok(classId);
  await waitFor(
    async () => remote.some((operation) => operation.entity_id === classId),
    "Supabase sync operation was not appended",
  );
  await waitFor(async () => {
    const snapshot = await page.evaluate(() => window.desk.snapshot());
    return snapshot.outbox.some(
      (operation) => operation.entityId === classId && operation.status === "synced",
    );
  }, "Local outbox operation did not become synced");
  const status = await page.evaluate(() => window.desk.syncStatus());
  assert.equal(status.authenticated, true);
  assert.equal(status.queued, 0);
  assert.equal(status.phase, "synced");
  await page.getByText("Cloud sync: ready", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Local sync boundary", exact: true }).scrollIntoViewIfNeeded();
  const firstVideo = page.video();
  await page.screenshot({ path: join(output, "cloud-sync.png") });
  await closeElectron(app);
  app = undefined;
  if (firstVideo) await copyFile(await firstVideo.path(), join(output, "cloud-sync-operated.webm"));

  await launch();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByText("Signed in as", { exact: false }).waitFor();
  const restarted = await page.evaluate(() => window.desk.syncStatus());
  assert.equal(restarted.authenticated, true);
  assert.equal(
    (await page.evaluate(() => window.desk.snapshot())).classes.at(-1)?.name,
    "Cloud Physics",
  );
  const second = await page.evaluate(() =>
    window.desk.command({ type: "class.create", name: "Cloud Chemistry" }),
  );
  assert.ok(second.classes.at(-1)?.id);
  await waitFor(
    async () => remote.some((operation) => operation.entity_id === second.classes.at(-1)?.id),
    "Supabase sync did not resume after the short-lived access token expired",
  );
  assert.equal(remote.length, 2);
  assert.equal(authGrants.filter((grant) => grant === "password").length, 1);
  assert.ok(
    authGrants.filter((grant) => grant === "refresh_token").length >= 1,
    "Supabase refresh-token grant was not used",
  );
  assert.ok(
    syncTokens.some((token) => token.includes("cloud-refresh-access-")),
    "rotated access token was not used for a subsequent sync",
  );

  // A transient refresh failure must leave the outbox queued and recover
  // without re-entering credentials or regenerating local work.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  refreshMode = "transient";
  const transient = await page.evaluate(() =>
    window.desk.command({ type: "class.create", name: "Cloud Biology" }),
  );
  await waitFor(
    async () => (await page.evaluate(() => window.desk.syncStatus())).phase === "error",
    "transient account refresh failure was not surfaced",
  );
  const transientStatus = await page.evaluate(() => window.desk.syncStatus());
  assert.match(transientStatus.lastError ?? "", /Local changes are safe/);
  assert.ok(
    (await page.evaluate(() => window.desk.snapshot())).outbox.some(
      (operation) => operation.entityId === transient.classes.at(-1)?.id && operation.status !== "synced",
    ),
  );

  refreshMode = "success";
  const recoveredStatus = await page.evaluate(() => window.desk.syncNow());
  assert.equal(recoveredStatus.phase, "synced");
  assert.equal(recoveredStatus.queued, 0);
  assert.equal(remote.length, 3);

  // A revoked refresh token must not be retried forever or mark local data as
  // synced. The renderer receives an actionable reauthentication state.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  refreshMode = "invalid";
  const invalid = await page.evaluate(() =>
    window.desk.command({ type: "class.create", name: "Cloud Chemistry Lab" }),
  );
  await waitFor(
    async () => (await page.evaluate(() => window.desk.syncStatus())).phase === "error",
    "invalid account refresh failure was not surfaced",
  );
  const invalidStatus = await page.evaluate(() => window.desk.syncStatus());
  assert.match(invalidStatus.lastError ?? "", /Reconnect the Desk account/);
  assert.equal(remote.length, 3);
  assert.ok(
    (await page.evaluate(() => window.desk.snapshot())).outbox.some(
      (operation) => operation.entityId === invalid.classes.at(-1)?.id && operation.status !== "synced",
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: authenticated main-process Supabase sync appends an account-scoped operation, marks the local outbox synced, persists across restart, and keeps SQLite authoritative.",
  );
} finally {
  if (app) await closeElectron(app);
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(data, { recursive: true, force: true });
}
