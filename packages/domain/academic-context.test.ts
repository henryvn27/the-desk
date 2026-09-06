import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("academic periods and spaces persist class links and protect linked context", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-context-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const physics = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const history = store.execute({ type: "class.create", name: "History" })
      .classes[1]!;
    const period = store.execute({
      type: "period.create",
      input: {
        name: "Fall 2026",
        kind: "semester",
        startsOn: "2026-08-24",
        endsOn: "2026-12-18",
        notes: "First semester",
        classIds: [physics.id, history.id, physics.id],
      },
    }).academicPeriods[0]!;
    assert.deepEqual(period.classIds, [physics.id, history.id]);
    assert.throws(
      () =>
        store.execute({
          type: "period.create",
          input: {
            name: "fall 2026",
            kind: "semester",
            startsOn: null,
            endsOn: null,
            notes: "Duplicate",
            classIds: [],
          },
        }),
      /already exists/,
    );
    const space = store.execute({
      type: "space.create",
      input: {
        name: "Main school",
        kind: "school",
        notes: "Primary workspace",
        classIds: [physics.id],
      },
    }).spaces[0]!;
    assert.deepEqual(store.snapshot().spaces[0]!.classIds, [physics.id]);
    assert.throws(
      () =>
        store.execute({
          type: "period.update",
          id: period.id,
          revision: period.revision,
          input: {
            ...period,
            startsOn: "2027-01-01",
            endsOn: "2026-12-31",
          },
        }),
      /end on or after/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "period.forget",
          id: period.id,
          revision: period.revision,
        }),
      /Unlink this academic period/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "space.forget",
          id: space.id,
          revision: space.revision,
        }),
      /Unlink this space/,
    );
    const updatedPeriod = store.execute({
      type: "period.update",
      id: period.id,
      revision: period.revision,
      input: {
        ...period,
        classIds: [physics.id],
        notes: "Updated semester",
      },
    }).academicPeriods[0]!;
    assert.equal(updatedPeriod.revision, 1);
    assert.deepEqual(updatedPeriod.classIds, [physics.id]);
    const unlinkedSpace = store.execute({
      type: "space.update",
      id: space.id,
      revision: space.revision,
      input: { ...space, classIds: [], notes: "Available workspace" },
    }).spaces[0]!;
    assert.equal(unlinkedSpace.revision, 1);
    assert.deepEqual(unlinkedSpace.classIds, []);
    store.close();
    store = new DeskStore(path);
    assert.equal(
      store.snapshot().academicPeriods[0]!.notes,
      "Updated semester",
    );
    assert.deepEqual(store.snapshot().academicPeriods[0]!.classIds, [
      physics.id,
    ]);
    assert.deepEqual(store.snapshot().spaces[0]!.classIds, []);
    store.execute({
      type: "period.update",
      id: updatedPeriod.id,
      revision: updatedPeriod.revision,
      input: { ...updatedPeriod, classIds: [] },
    });
    store.execute({
      type: "period.forget",
      id: updatedPeriod.id,
      revision: updatedPeriod.revision + 1,
    });
    store.execute({
      type: "space.forget",
      id: unlinkedSpace.id,
      revision: unlinkedSpace.revision,
    });
    assert.equal(store.snapshot().academicPeriods.length, 0);
    assert.equal(store.snapshot().spaces.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("academic context rejects unknown classes and stale revisions", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "English" })
      .classes[0]!.id;
    assert.throws(
      () =>
        store.execute({
          type: "space.create",
          input: {
            name: "Unknown",
            kind: "workspace",
            notes: "",
            classIds: ["00000000-0000-0000-0000-000000000000"],
          },
        }),
      /existing classes/,
    );
    const space = store.execute({
      type: "space.create",
      input: {
        name: "Desk",
        kind: "workspace",
        notes: "",
        classIds: [classId],
      },
    }).spaces[0]!;
    assert.throws(
      () =>
        store.execute({
          type: "space.update",
          id: space.id,
          revision: 9,
          input: { ...space, notes: "stale" },
        }),
      /changed elsewhere/,
    );
  } finally {
    store.close();
  }
});
