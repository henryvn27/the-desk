import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SupabaseSyncCoordinator } from "../../apps/desktop/electron/supabase-sync";
import { DeskStore } from "../domain/store";
import type { SupabaseSyncContext } from "./supabase-sync";
import type { SupabaseAccountStatus } from "./supabase-auth";

const userId = "00000000-0000-4000-8000-000000000010";

function fakeAccount(url: string) {
  const context: SupabaseSyncContext = {
    url,
    publishableKey: "test-publishable-key",
    accessToken: "test-access-token",
    userId,
  };
  const account = {
    status: (): SupabaseAccountStatus => ({
      configured: true,
      authenticated: true,
      email: "student@example.edu",
      userId,
      secureStorage: true,
      source: "process-env",
    }),
    syncContext: () => context,
  };
  return account;
}

async function listen(
  handler: (request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("sync coordinator records transport failures and retries without false success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-sync-coordinator-error-"));
  const database = join(directory, "desk.sqlite");
  let failPost = true;
  const { server, url } = await listen((request, response) => {
    if (!request.url?.startsWith("/rest/v1/desk_sync_operations")) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" }).end("[]");
      return;
    }
    if (failPost) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(201).end();
  });
  const store = new DeskStore(database);
  try {
    store.execute({ type: "class.create", name: "Retry Physics" });
    const coordinator = new SupabaseSyncCoordinator(
      () => store,
      fakeAccount(url),
    );
    let status = await coordinator.syncNow();
    assert.equal(status.phase, "error");
    assert.equal(status.queued, 1);
    assert.match(status.lastError ?? "", /HTTP 503/);
    assert.equal(store.snapshot().outbox.at(-1)?.status, "retrying");

    failPost = false;
    status = await coordinator.syncNow();
    assert.equal(status.phase, "synced");
    assert.equal(status.queued, 0);
    assert.equal(status.uploaded, 1);
    assert.equal(store.snapshot().outbox.at(-1)?.status, "synced");
    coordinator.close();
  } finally {
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync coordinator exposes newer remote copies as an explicit conflict phase", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-sync-coordinator-conflict-"));
  const database = join(directory, "desk.sqlite");
  const remoteOperation = {
    operation_id: "00000000-0000-4000-8000-000000000020",
    entity_id: "placeholder",
    operation: "class.create",
    payload: { name: "Remote Physics" },
    created_at: "2026-09-07T12:00:00.000Z",
  };
  const { server, url } = await listen((request, response) => {
    if (!request.url?.startsWith("/rest/v1/desk_sync_operations")) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "GET") {
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify([remoteOperation]));
      return;
    }
    response.writeHead(201).end();
  });
  const store = new DeskStore(database);
  try {
    const created = store.execute(
      { type: "class.create", name: "Local Physics" },
      new Date("2026-09-06T12:00:00.000Z"),
    );
    const operation = created.outbox.at(-1)!;
    remoteOperation.entity_id = operation.entityId;
    const coordinator = new SupabaseSyncCoordinator(
      () => store,
      fakeAccount(url),
    );
    const status = await coordinator.syncNow();
    assert.equal(status.phase, "conflict");
    assert.equal(status.unresolvedConflicts, 1);
    assert.equal(status.queued, 0);
    assert.equal(store.snapshot().outbox.at(-1)?.status, "conflict");
    assert.equal(store.snapshot().syncConflicts[0]?.operationId, operation.id);
    coordinator.close();
  } finally {
    store.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
