import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("tutoring preference survives restart without changing academic work and rejects unknown modes", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-tutoring-"));
  let store = new DeskStore(join(dir, "desk.sqlite"));
  try {
    assert.equal(store.snapshot().tutoringMode, "balanced");
    store.execute({ type: "tutor.mode", mode: "guide" });
    const before = store.snapshot();
    assert.throws(() =>
      store.execute({ type: "tutor.mode", mode: "submit-for-me" as never }),
    );
    assert.deepEqual(store.snapshot(), before);
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot(), before);
    const after = store.execute({ type: "tutor.mode", mode: "direct" });
    assert.equal(after.tutoringMode, "direct");
    assert.deepEqual(after.tasks, before.tasks);
    assert.deepEqual(after.sessions, before.sessions);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
