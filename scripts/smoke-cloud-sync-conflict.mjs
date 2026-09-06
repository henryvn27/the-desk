import { _electron as electron } from "playwright";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { closeElectron } from "./close-electron.mjs";

const data = await mkdtemp(join(tmpdir(), "desk-cloud-sync-conflict-"));
const output = resolve("artifacts/cloud-sync");
await mkdir(output, { recursive: true });
const requests = [];
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url });
  if (request.url?.startsWith("/auth/v1/token")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: "cloud-access-token",
        refresh_token: "cloud-refresh-token",
        expires_in: 3600,
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
    if (request.method === "GET") {
      const query = new URL(request.url, "http://127.0.0.1").searchParams;
      const entityId = query.get("entity_id")?.replace(/^eq\./, "") ?? "unknown";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify([
          {
            operation_id: "00000000-0000-4000-8000-000000000020",
            entity_id: entityId,
            operation: "class.create",
            payload: { entityId, operation: "class.create", remote: true },
            created_at: "2026-09-07T12:00:00.000Z",
          },
        ]),
      );
      return;
    }
    response.writeHead(201);
    response.end();
    return;
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
    window.desk.command({ type: "class.create", name: "Conflict Physics" }),
  );
  const classId = created.classes.at(-1)?.id;
  assert.ok(classId);
  await waitFor(
    async () => {
      const status = await page.evaluate(() => window.desk.syncStatus());
      return status.phase === "conflict" && status.unresolvedConflicts === 1;
    },
    "Remote conflict was not surfaced",
  );
  const snapshot = await page.evaluate(() => window.desk.snapshot());
  assert.equal(snapshot.outbox.at(-1)?.status, "conflict");
  assert.equal(snapshot.syncConflicts.at(-1)?.entityId, classId);
  assert.equal(
    requests.filter(
      (request) =>
        request.method === "POST" &&
        request.path?.startsWith("/rest/v1/desk_sync_operations"),
    ).length,
    0,
  );
  await page.getByText("Cloud sync: conflict review", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Local sync boundary", exact: true }).scrollIntoViewIfNeeded();
  const firstVideo = page.video();
  await page.screenshot({ path: join(output, "cloud-sync-conflict.png") });
  await closeElectron(app);
  app = undefined;
  if (firstVideo)
    await copyFile(
      await firstVideo.path(),
      join(output, "cloud-sync-conflict-operated.webm"),
    );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: installed Supabase sync preserves a newer remote copy, pauses the local operation, and renders explicit conflict review without silently overwriting SQLite.",
  );
} finally {
  if (app) await closeElectron(app);
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(data, { recursive: true, force: true });
}
