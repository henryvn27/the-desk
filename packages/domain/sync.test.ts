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
    const envelope = store.syncBatch()[0]!;
    assert.equal(envelope.id, operationId);
    assert.match(envelope.payload, /Physics/);
    store.markSyncAttempt(operationId!, "2026-09-06T12:01:00.000Z");
    store.markSynced(operationId!, "2026-09-06T12:02:00.000Z");
    assert.equal(store.snapshot().outbox.at(-1)?.status, "synced");
    store.close();

    const restarted = new DeskStore(database);
    assert.equal(restarted.snapshot().outbox.at(-1)?.id, operationId);
    assert.equal(restarted.snapshot().outbox.at(-1)?.status, "synced");
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

test("approved remote conflicts apply transactionally and are idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-sync-remote-apply-"));
  const database = join(directory, "desk.sqlite");
  try {
    const store = new DeskStore(database);
    const created = store.execute(
      { type: "class.create", name: "Local Physics" },
      new Date("2026-09-06T12:00:00Z"),
    );
    const local = created.classes[0]!;
    const operation = created.outbox.at(-1)!;
    const localPayload = store.syncBatch()[0]!.payload;
    const remotePayload = JSON.stringify({
      entityId: local.id,
      operation: operation.operation,
      record: {
        table: "classes",
        row: { id: local.id, name: "Physics (school)", color: local.color },
      },
    });
    const conflict = store.recordSyncConflict(
      {
        entityId: local.id,
        operationId: operation.id,
        operation: operation.operation,
        localData: localPayload,
        remoteData: remotePayload,
      },
      new Date("2026-09-06T12:01:00Z"),
    );
    const resolved = store.execute(
      {
        type: "sync.conflict.resolve",
        id: conflict.syncConflicts[0]!.id,
        resolution: "keep-remote",
      },
      new Date("2026-09-06T12:02:00Z"),
    );
    const applied = store.execute(
      { type: "sync.conflict.apply-remote", id: resolved.syncConflicts[0]!.id },
      new Date("2026-09-06T12:03:00Z"),
    );
    assert.equal(applied.classes[0]?.name, "Physics (school)");
    assert.equal(applied.outbox.at(-1)?.status, "resolved");
    assert.match(applied.outbox.at(-1)?.lastError ?? "", /applied locally/);

    const replayed = store.execute({
      type: "sync.conflict.apply-remote",
      id: applied.syncConflicts[0]!.id,
    });
    assert.equal(replayed.classes[0]?.name, "Physics (school)");
    assert.equal(replayed.classes.length, 1);
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote conflict application refuses a newer local copy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desk-sync-remote-stale-"));
  const database = join(directory, "desk.sqlite");
  try {
    const store = new DeskStore(database);
    const created = store.execute(
      {
        type: "source.create",
        input: {
          title: "Formula sheet",
          text: "F = ma",
          classIds: [],
          taskIds: [],
        },
      },
      new Date("2026-09-06T12:00:00Z"),
    );
    const source = created.sources[0]!;
    const operation = created.outbox.at(-1)!;
    const localPayload = store.syncBatch()[0]!.payload;
    const remotePayload = JSON.stringify({
      entityId: source.id,
      operation: operation.operation,
      record: {
        table: "sources",
        row: {
          id: source.id,
          title: source.title,
          text: "F = m × a",
          createdAt: source.createdAt,
          authority: source.authority,
          kind: "unspecified",
          revision: 0,
        },
        classIds: [],
        taskIds: [],
      },
    });
    const conflict = store.recordSyncConflict({
      entityId: source.id,
      operationId: operation.id,
      operation: operation.operation,
      localData: localPayload,
      remoteData: remotePayload,
    });
    store.execute({
      type: "sync.conflict.resolve",
      id: conflict.syncConflicts[0]!.id,
      resolution: "keep-remote",
    });
    store.execute({
      type: "source.classify",
      id: source.id,
      revision: source.revision ?? 0,
      kind: "class-material",
    });
    assert.throws(
      () => store.applyRemoteConflict(conflict.syncConflicts[0]!.id),
      /local copy changed/,
    );
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
