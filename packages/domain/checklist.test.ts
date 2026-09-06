import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import type { ChecklistItem } from "./contracts";

test("checklist progress is explicit, revision checked, restorable and retained at session end", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-checklist-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    store.execute({ type: "planning.mode", mode: "suggest" });
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Vectors",
        classId,
        minutes: 30,
        dueAt: null,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    const first = store.execute({
      type: "checklist.add",
      taskId: task.id,
      title: "Draw components",
    }).tasks[0]!.checklist![0]!;
    assert.throws(
      () => store.execute({ type: "task.undo", id: task.id }),
      /checklist work/,
    );
    const active = store.execute({ type: "session.start", taskId: task.id })
      .sessions[0]!;
    const update = (
      item: ChecklistItem,
      changes: Partial<Pick<ChecklistItem, "title" | "completed" | "archived">>,
    ) =>
      store.execute({
        type: "checklist.update",
        taskId: task.id,
        id: item.id,
        revision: item.revision,
        input: {
          title: item.title,
          completed: item.completed,
          archived: item.archived,
          ...changes,
        },
      });
    let state = update(first, { completed: true });
    assert.equal(state.tasks[0]!.completed, false);
    assert.equal(
      state.tasks[0]!.revision,
      active.estimateAtStart!.taskRevision,
    );
    assert.throws(() => update(first, { completed: false }), /changed/);
    assert.deepEqual(store.snapshot(), state);
    state = update(state.tasks[0]!.checklist![0]!, {
      title: "Resolve x and y",
    });
    assert.equal(state.tasks[0]!.revision, 2);
    state = update(state.tasks[0]!.checklist![0]!, { archived: true });
    assert.equal(state.tasks[0]!.checklist![0]!.completed, true);
    store.close();
    store = new DeskStore(path);
    assert.deepEqual(store.snapshot(), state);
    state = update(state.tasks[0]!.checklist![0]!, { archived: false });
    const ended = store.execute({ type: "session.end", completed: false })
      .sessions[0]!;
    assert.deepEqual(ended.checklistAtEnd, [
      { id: first.id, title: "Resolve x and y", completed: true },
    ]);
    state = update(state.tasks[0]!.checklist![0]!, {
      completed: false,
      title: "Revisit components",
    });
    assert.deepEqual(
      store.snapshot().sessions[0]!.checklistAtEnd,
      ended.checklistAtEnd,
    );
    store.execute({ type: "session.start", taskId: task.id });
    store.execute({ type: "session.end", completed: true });
    assert.throws(
      () => update(state.tasks[0]!.checklist![0]!, { completed: true }),
      /Reopen the task/,
    );
    store.close();
    store = new DeskStore(path);
    assert.deepEqual(
      store.snapshot().sessions[0]!.checklistAtEnd,
      ended.checklistAtEnd,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});
test("checklist input and ownership checks leave state unchanged", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Vectors",
        classId,
        minutes: 30,
        dueAt: null,
        resource: null,
        notes: "",
        deadlineConfirmed: false,
      },
    }).tasks[0]!;
    const before = store.snapshot();
    assert.throws(() =>
      store.execute({ type: "checklist.add", taskId: task.id, title: "   " }),
    );
    assert.throws(() =>
      store.execute({
        type: "checklist.update",
        taskId: task.id,
        id: classId,
        revision: 0,
        input: { title: "Wrong item", completed: true, archived: false },
      }),
    );
    assert.deepEqual(store.snapshot(), before);
  } finally {
    store.close();
  }
});
