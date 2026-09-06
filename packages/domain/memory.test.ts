import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
test("explicit memories persist, correct atomically, reject stale writes and can be forgotten", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-memory-"));
  let store = new DeskStore(join(dir, "desk.sqlite"));
  try {
    const input = {
      text: "I prefer math earlier",
      category: "preference" as const,
      classId: null,
    };
    const memory = store.execute({ type: "memory.create", input }).memories[0]!;
    assert.equal(memory.origin, "explicit");
    assert.throws(
      () =>
        store.execute({
          type: "memory.create",
          input: { ...input, classId: "00000000-0000-4000-8000-000000000000" },
        }),
      /existing class/,
    );
    const updated = store.execute({
      type: "memory.update",
      id: memory.id,
      revision: 0,
      input: { ...input, text: "I prefer math after lunch" },
    }).memories[0]!;
    assert.equal(updated.revision, 1);
    assert.throws(
      () =>
        store.execute({ type: "memory.forget", id: memory.id, revision: 0 }),
      /changed elsewhere/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "memory.update",
          id: memory.id,
          revision: 0,
          input,
        }),
      /changed elsewhere/,
    );
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot().memories, [updated]);
    const forgotten = store.execute({
      type: "memory.forget",
      id: memory.id,
      revision: 1,
    });
    assert.equal(forgotten.memories.length, 0);
    assert.equal(forgotten.tasks.length, 0);
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.equal(store.snapshot().memories.length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
