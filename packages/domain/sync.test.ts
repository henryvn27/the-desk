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
