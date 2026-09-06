import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("source type defaults unknown and supports revision-checked corrections across restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-source-kind-"));
  let store = new DeskStore(join(dir, "desk.sqlite"));
  try {
    const source = store.execute({
      type: "source.create",
      input: {
        title: "Passage",
        text: "Original text",
        classIds: [],
        taskIds: [],
      },
    }).sources[0]!;
    assert.equal(source.kind, "unspecified");
    store.close();
    const legacy = new DatabaseSync(join(dir, "desk.sqlite"));
    legacy.exec(
      "ALTER TABLE sources DROP COLUMN kind; ALTER TABLE sources DROP COLUMN revision; PRAGMA user_version=21;",
    );
    legacy.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot().sources[0], source);
    const changed = store.execute({
      type: "source.classify",
      id: source.id,
      revision: 0,
      kind: "class-material",
    }).sources[0]!;
    assert.equal(changed.kind, "class-material");
    assert.equal(changed.authority, "user-provided-text");
    assert.equal(changed.text, source.text);
    assert.throws(
      () =>
        store.execute({
          type: "source.classify",
          id: source.id,
          revision: 0,
          kind: "general-web",
        }),
      /changed elsewhere/,
    );
    assert.throws(() =>
      store.execute({
        type: "source.classify",
        id: source.id,
        revision: 1,
        kind: "verified-teacher" as never,
      }),
    );
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot().sources[0], changed);
    assert.equal(
      store.execute({
        type: "source.classify",
        id: source.id,
        revision: 1,
        kind: "assigned-textbook",
      }).sources[0]!.revision,
      2,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
