import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("tracks and units persist hierarchy, validate ownership, and protect links", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-units-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const physics = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const history = store.execute({ type: "class.create", name: "History" })
      .classes[1]!;
    const physicsTask = store.execute({
      type: "task.create",
      input: {
        title: "Kinematics review",
        classId: physics.id,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    const historyTask = store.execute({
      type: "task.create",
      input: {
        title: "Revolutions review",
        classId: history.id,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[1]!;
    const track = store.execute({
      type: "track.create",
      input: { classId: physics.id, name: "Mechanics", notes: "" },
    }).tracks[0]!;
    assert.throws(
      () =>
        store.execute({
          type: "track.create",
          input: { classId: physics.id, name: "mechanics", notes: "" },
        }),
      /already exists/,
    );
    const unit = store.execute({
      type: "unit.create",
      input: {
        classId: physics.id,
        trackId: track.id,
        name: "Kinematics",
        kind: "unit",
        sequence: 2,
        notes: "Vectors and motion",
        taskIds: [physicsTask.id, physicsTask.id],
      },
    }).units[0]!;
    assert.deepEqual(unit.taskIds, [physicsTask.id]);
    assert.equal(store.snapshot().units[0]!.trackId, track.id);
    assert.throws(
      () =>
        store.execute({
          type: "unit.create",
          input: {
            classId: physics.id,
            trackId: track.id,
            name: "kinematics",
            kind: "module",
            sequence: 3,
            notes: "Duplicate",
            taskIds: [],
          },
        }),
      /already exists/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "unit.update",
          id: unit.id,
          revision: unit.revision,
          input: {
            ...unit,
            classId: history.id,
            trackId: track.id,
            taskIds: [historyTask.id],
          },
        }),
      /belong to the selected class/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "track.forget",
          id: track.id,
          revision: track.revision,
        }),
      /units/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "task.update",
          id: physicsTask.id,
          input: {
            ...physicsTask,
            classId: history.id,
          },
          deadlineChangeApproved: false,
        }),
      /unit/,
    );
    assert.throws(
      () => store.execute({ type: "task.undo", id: physicsTask.id }),
      /unit/,
    );
    const unlinked = store.execute({
      type: "unit.update",
      id: unit.id,
      revision: unit.revision,
      input: {
        ...unit,
        trackId: null,
        taskIds: [],
        notes: "No longer grouped",
      },
    }).units[0]!;
    assert.equal(unlinked.trackId, null);
    assert.deepEqual(unlinked.taskIds, []);
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().units[0]!.notes, "No longer grouped");
    store.execute({
      type: "unit.forget",
      id: unlinked.id,
      revision: unlinked.revision,
    });
    store.execute({
      type: "track.forget",
      id: track.id,
      revision: track.revision,
    });
    assert.equal(store.snapshot().tracks.length, 0);
    assert.equal(store.snapshot().units.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("tracks and units reject cross-class references", () => {
  const store = new DeskStore(":memory:");
  try {
    const physics = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const history = store.execute({ type: "class.create", name: "History" })
      .classes[1]!;
    const track = store.execute({
      type: "track.create",
      input: { classId: physics.id, name: "Mechanics", notes: "" },
    }).tracks[0]!;
    assert.throws(
      () =>
        store.execute({
          type: "unit.create",
          input: {
            classId: history.id,
            trackId: track.id,
            name: "Invalid",
            kind: "unit",
            sequence: 0,
            notes: "",
            taskIds: [],
          },
        }),
      /belong to the selected class/,
    );
  } finally {
    store.close();
  }
});
