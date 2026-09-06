import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DeskStore } from "./store";

test("local outbox records durable intent without claiming cloud sync", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-sync-"));
  const database = join(directory, "desk.sqlite");
  try {
    const store = new DeskStore(database);
    const created = store.execute({ type: "class.create", name: "Physics" });
    assert.ok(created.outbox.length > 0);
    assert.equal(created.outbox.at(-1)?.operation, "class.create");
    const operationId = created.outbox.at(-1)?.id;
    store.close();

    const restarted = new DeskStore(database);
    assert.equal(restarted.snapshot().outbox.at(-1)?.id, operationId);
    assert.equal(restarted.snapshot().classes[0]?.name, "Physics");
    restarted.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sync conflict preserves both copies, requires a decision, and keeps retry honest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-sync-conflict-"));
  const database = join(directory, "desk.sqlite");
  try {
    const store = new DeskStore(database);
    let snapshot = store.execute(
      { type: "class.create", name: "Physics" },
      new Date("2026-09-06T12:00:00Z"),
    );
    const course = snapshot.classes[0]!;
    const operation = snapshot.outbox.at(-1)!;
    const local = JSON.stringify(course);
    const remote = JSON.stringify({ ...course, name: "Physics (school)" });
    snapshot = store.execute(
      {
        type: "sync.conflict.record",
        input: {
          entityId: course.id,
          operationId: operation.id,
          operation: "class.create",
          localData: local,
          remoteData: remote,
        },
      },
      new Date("2026-09-06T12:01:00Z"),
    );
    assert.equal(snapshot.outbox.at(-1)?.status, "conflict");
    assert.deepEqual(snapshot.syncConflicts[0], {
      id: snapshot.syncConflicts[0]!.id,
      entityId: course.id,
      operationId: operation.id,
      operation: "class.create",
      localData: local,
      remoteData: remote,
      detectedAt: "2026-09-06T12:01:00.000Z",
      resolution: "unresolved",
      resolvedAt: null,
    });
    assert.throws(
      () => store.execute({ type: "sync.retry", id: operation.id }),
      /No local operation is waiting to retry/,
    );
    snapshot = store.execute(
      {
        type: "sync.conflict.resolve",
        id: snapshot.syncConflicts[0]!.id,
        resolution: "keep-local",
      },
      new Date("2026-09-06T12:02:00Z"),
    );
    assert.equal(snapshot.syncConflicts[0]!.resolution, "keep-local");
    assert.equal(snapshot.outbox.at(-1)?.status, "queued");
    snapshot = store.execute(
      { type: "sync.retry", id: operation.id },
      new Date("2026-09-06T12:03:00Z"),
    );
    assert.equal(snapshot.outbox.at(-1)?.attempts, 2);
    assert.match(snapshot.outbox.at(-1)?.lastError ?? "", /not connected/);
    store.close();

    const restarted = new DeskStore(database);
    assert.equal(restarted.snapshot().syncConflicts[0]!.localData, local);
    assert.equal(restarted.snapshot().syncConflicts[0]!.remoteData, remote);
    assert.equal(restarted.snapshot().outbox.at(-1)?.status, "queued");
    restarted.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
