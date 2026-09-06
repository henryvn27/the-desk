import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";
import { waitFor } from "./wait-for.mjs";

const data = await mkdtemp(join(tmpdir(), "desk-acceptance-v1-"));
const output = resolve("artifacts/acceptance-v1");
await mkdir(output, { recursive: true });

const fixtures = [
  {
    name: "AP Physics C",
    tasks: [
      {
        title: "Rotational dynamics problem set",
        dueAt: "2026-09-09T23:59:00.000Z",
        minutes: 75,
        resource: "https://school.example/physics/rotation",
        notes: "Problems 14–28; bring the formula sheet.",
        deadlineConfirmed: true,
        workKind: "assignment",
        importance: "high",
      },
      {
        title: "Torque quiz review",
        dueAt: "2026-09-11T14:00:00.000Z",
        minutes: 35,
        resource: null,
        notes: "Recheck sign conventions.",
        deadlineConfirmed: true,
        workKind: "assessment",
        importance: "high",
      },
    ],
  },
  {
    name: "AP Statistics",
    tasks: [
      {
        title: "Sampling distributions practice",
        dueAt: "2026-09-10T23:59:00.000Z",
        minutes: 50,
        resource: null,
        notes: "Show calculator setup and interpretation.",
        deadlineConfirmed: true,
        workKind: "assignment",
        importance: "normal",
      },
      {
        title: "Chapter 7 optional review",
        dueAt: null,
        minutes: 25,
        resource: null,
        notes: "Use only if the core work is finished.",
        deadlineConfirmed: false,
        workKind: "optional-review",
        importance: "low",
      },
    ],
  },
  {
    name: "English 12",
    tasks: [
      {
        title: "Beloved passage analysis",
        dueAt: "2026-09-12T03:59:00.000Z",
        minutes: 90,
        resource: "https://school.example/english/beloved",
        notes: "Connect diction to the narrator's point of view.",
        deadlineConfirmed: true,
        workKind: "assignment",
        importance: "normal",
      },
      {
        title: "Seminar question draft",
        dueAt: "2026-09-14T13:00:00.000Z",
        minutes: 30,
        resource: null,
        notes: "Draft two questions supported by the text.",
        deadlineConfirmed: true,
        workKind: "assignment",
        importance: "normal",
      },
    ],
  },
];

const requests = [];
let syncMode = "error";
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url });

  if (request.url?.startsWith("/auth/v1/token")) {
    const email = JSON.parse(body).email;
    if (email === "failure@example.edu") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error_description: "Invalid login credentials." }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: "acceptance-access-token",
        refresh_token: "acceptance-refresh-token",
        expires_in: 3600,
        user: {
          id: "00000000-0000-4000-8000-000000000010",
          email,
        },
      }),
    );
    return;
  }

  if (request.url?.startsWith("/rest/v1/desk_sync_operations")) {
    if (syncMode === "error") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Synthetic offline failure" }));
      return;
    }
    if (request.method === "GET") {
      const query = new URL(request.url, "http://127.0.0.1").searchParams;
      const entityId = query.get("entity_id")?.replace(/^eq\./, "");
      assert.ok(entityId);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify([
          {
            operation_id: "00000000-0000-4000-8000-000000000099",
            entity_id: entityId,
            operation: "remote.change",
            payload: { entityId, remote: true },
            created_at: "2099-01-01T00:00:00.000Z",
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

await new Promise((resolveServer) =>
  server.listen(0, "127.0.0.1", resolveServer),
);
const address = server.address();
assert.ok(address && typeof address === "object");
const supabaseUrl = `http://127.0.0.1:${address.port}`;

let app;
let page;
const rendererErrors = [];
const observedPages = new WeakSet();

function observeRenderer(candidate) {
  if (observedPages.has(candidate)) return;
  observedPages.add(candidate);
  candidate.on("pageerror", (error) =>
    rendererErrors.push(`pageerror: ${error.message}`),
  );
  candidate.on("console", (message) => {
    if (message.type() === "error")
      rendererErrors.push(`console.error: ${message.text()}`);
  });
  candidate.on("crash", () => rendererErrors.push("renderer crash"));
}

async function launch(online) {
  const env = {
    ...process.env,
    DESK_DATA_DIR: data,
    DESK_ENABLE_DEVELOPMENT_KEY: "0",
    TZ: "UTC",
  };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_PUBLISHABLE_KEY;
  if (online) {
    env.SUPABASE_URL = supabaseUrl;
    env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  }
  app = await electron.launch({
    args: process.env.DESK_EXECUTABLE ? [] : ["."],
    executablePath: process.env.DESK_EXECUTABLE,
    env,
  });
  app.on("window", observeRenderer);
  for (const candidate of app.windows()) observeRenderer(candidate);
  await app.firstWindow();
  await waitFor(() => {
    page = app.windows().find((window) => window.url().endsWith("#main"));
    if (page) observeRenderer(page);
    return Boolean(page);
  }, "Main Desk window did not open");
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
}

async function close() {
  if (app) await app.close();
  app = undefined;
  page = undefined;
}

const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b));
const expectedClasses = sorted(fixtures.map((fixture) => fixture.name));
const expectedTasks = sorted(
  fixtures.flatMap((fixture) => fixture.tasks.map((task) => task.title)),
);

try {
  await launch(false);
  const offline = await page.evaluate(async (input) => {
    let snapshot = await window.desk.snapshot();
    for (const fixture of input) {
      snapshot = await window.desk.command({
        type: "class.create",
        name: fixture.name,
      });
      const classId = snapshot.classes.find(
        (candidate) => candidate.name === fixture.name,
      )?.id;
      if (!classId) throw Error(`Class was not created: ${fixture.name}`);
      for (const task of fixture.tasks) {
        snapshot = await window.desk.command({
          type: "task.create",
          input: { ...task, classId },
        });
      }
    }
    return snapshot;
  }, fixtures);

  assert.deepEqual(
    sorted(offline.classes.map((item) => item.name)),
    expectedClasses,
  );
  assert.deepEqual(
    sorted(offline.tasks.map((item) => item.title)),
    expectedTasks,
  );
  assert.equal(offline.classes.length, 3);
  assert.equal(offline.tasks.length, 6);
  for (const fixture of fixtures) {
    const classId = offline.classes.find(
      (candidate) => candidate.name === fixture.name,
    )?.id;
    assert.ok(classId);
    assert.deepEqual(
      sorted(
        offline.tasks
          .filter((task) => task.classId === classId)
          .map((task) => task.title),
      ),
      sorted(fixture.tasks.map((task) => task.title)),
    );
  }
  assert.ok(offline.outbox.length >= 9);
  assert.ok(offline.outbox.every((operation) => operation.status === "queued"));
  assert.equal(
    requests.length,
    0,
    "Offline writes must not contact cloud services",
  );
  for (const fixture of fixtures) {
    await page
      .getByRole("button", { name: fixture.name, exact: true })
      .waitFor();
  }
  await page
    .getByRole("button", { name: "AP Statistics", exact: true })
    .click();
  await page
    .getByText("Sampling distributions practice", { exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "offline-multi-class.png") });

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByText(
      "Cloud account access is not configured in this build. The local SQLite workspace remains available and no cloud sync is claimed.",
      { exact: true },
    )
    .waitFor();
  await page.getByText("Cloud sync: not connected", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);

  await close();
  await launch(false);
  const restarted = await page.evaluate(() => window.desk.snapshot());
  assert.deepEqual(restarted.classes, offline.classes);
  assert.deepEqual(restarted.tasks, offline.tasks);
  assert.deepEqual(restarted.outbox, offline.outbox);
  assert.equal(
    requests.length,
    0,
    "Offline restart must not contact cloud services",
  );
  await page.getByRole("button", { name: "English 12", exact: true }).click();
  await page.getByText("Beloved passage analysis", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);

  await close();
  await launch(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("heading", { name: "Desk account", exact: true })
    .waitFor();
  await page
    .getByLabel("Account email", { exact: true })
    .fill("failure@example.edu");
  await page
    .getByLabel("Password", { exact: true })
    .fill("long-enough-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByText("Account request failed: Invalid login credentials.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await page.evaluate(() => window.desk.accountStatus())).authenticated,
    false,
  );

  await page
    .getByLabel("Account email", { exact: true })
    .fill("student@example.edu");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByText("Signed in to the Desk account.", { exact: true })
    .waitFor();
  await waitFor(
    async () =>
      (await page.evaluate(() => window.desk.syncStatus())).phase === "error",
    "Cloud sync failure was not surfaced",
  );
  await page.getByText("Cloud sync: unavailable", { exact: true }).waitFor();
  await page
    .getByText("Cloud sync request failed (HTTP 503).", { exact: true })
    .waitFor();
  const afterFailure = await page.evaluate(() => window.desk.snapshot());
  assert.deepEqual(afterFailure.classes, offline.classes);
  assert.deepEqual(afterFailure.tasks, offline.tasks);
  assert.ok(
    afterFailure.outbox.some(
      (operation) =>
        operation.status === "retrying" &&
        operation.lastError === "Cloud sync request failed (HTTP 503).",
    ),
  );
  await page.screenshot({ path: join(output, "sync-failure.png") });

  syncMode = "conflict";
  await page
    .getByRole("button", { name: "Retry queued operations", exact: true })
    .click();
  await waitFor(
    async () =>
      (await page.evaluate(() => window.desk.syncStatus())).phase ===
      "conflict",
    "Cloud sync conflict was not surfaced after retry",
  );
  await page
    .getByText("Cloud sync: conflict review", { exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "Preserved conflicts", exact: true })
    .waitFor();
  await page.getByText("Needs review", { exact: true }).first().waitFor();
  await page
    .getByText("View preserved local and remote copies", { exact: true })
    .first()
    .click();
  await page.getByText("Local copy", { exact: true }).first().waitFor();
  await page.getByText("Remote copy", { exact: true }).first().waitFor();

  const conflicted = await page.evaluate(() => window.desk.snapshot());
  assert.deepEqual(conflicted.classes, offline.classes);
  assert.deepEqual(conflicted.tasks, offline.tasks);
  assert.ok(
    conflicted.outbox.some((operation) => operation.status === "conflict"),
  );
  assert.ok(
    conflicted.syncConflicts.some(
      (conflict) =>
        conflict.resolution === "unresolved" &&
        conflict.localData.length > 0 &&
        conflict.remoteData.includes('"remote":true'),
    ),
  );
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.screenshot({ path: join(output, "sync-conflict.png") });
  assert.deepEqual(rendererErrors, []);

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        flows: [
          "three classes and six realistic tasks save through trusted IPC while cloud configuration is absent",
          "offline writes and queued outbox state survive an Electron restart with stable IDs and relationships",
          "account rejection is rendered without changing local academic state",
          "cloud transport failure remains retryable and renders an unavailable state",
          "retry detects a newer remote copy, preserves both copies and renders explicit conflict review",
          "all observed renderer page errors, console errors and crashes fail the smoke",
        ],
        limitations: [
          process.env.DESK_EXECUTABLE
            ? "installed executable supplied by DESK_EXECUTABLE"
            : "development Electron executable",
          "isolated loopback account and sync fixture, not production Supabase",
          "bounded offline/sync acceptance, not full V1 release acceptance",
        ],
        artifacts: output,
      },
      null,
      2,
    ),
  );
} finally {
  await close().catch(() => {});
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(data, { recursive: true, force: true });
}
