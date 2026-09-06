import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import type { Command } from "./contracts";

test("completion corrections retain measured evidence and review history across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-correction-"));
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
    store.execute(
      { type: "session.start", taskId: task.id },
      new Date("2026-09-05T10:00:00Z"),
    );
    const ended = store.execute(
      { type: "session.end", completed: true },
      new Date("2026-09-05T10:20:00Z"),
    ).sessions[0]!;
    const corrected: Command = {
      type: "session.correct",
      id: ended.id,
      revision: 0,
      taskRevision: 0,
      completed: false,
      remainingMinutes: 15,
      notes: "Problems remain",
    };
    for (const invalid of [
      { ...corrected, remainingMinutes: null },
      { ...corrected, completed: true },
    ]) {
      const before = store.snapshot();
      assert.throws(() => store.execute(invalid));
      assert.deepEqual(store.snapshot(), before);
    }
    const reopened = store.execute(corrected, new Date("2026-09-05T10:25:00Z"));
    assert.equal(reopened.tasks[0]!.completed, false);
    assert.equal(reopened.tasks[0]!.minutes, 15);
    assert.equal(reopened.sessions[0]!.actualMinutes, 20);
    assert.deepEqual(
      reopened.sessions[0]!.estimateAtStart,
      ended.estimateAtStart,
    );
    assert.equal(reopened.sessions[0]!.corrections?.[0]!.fromCompleted, true);
    assert.throws(() => store.execute(corrected), /changed/);
    assert.deepEqual(store.snapshot(), reopened);
    store.close();
    store = new DeskStore(path);
    assert.deepEqual(store.snapshot(), reopened);
    const finished = store.execute({
      ...corrected,
      revision: 1,
      taskRevision: 1,
      completed: true,
      remainingMinutes: null,
      notes: "Actually completed",
    });
    assert.equal(finished.tasks[0]!.completed, true);
    assert.equal(finished.sessions[0]!.corrections?.length, 2);
    assert.equal(
      finished.sessions[0]!.corrections?.[1]!.previousReview?.notes,
      "Problems remain",
    );
    assert.equal(finished.sessions[0]!.actualMinutes, 20);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test("new review, task edits, and newer sessions prevent stale completion corrections", () => {
  const store = new DeskStore(":memory:");
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
    const active = store.execute({ type: "session.start", taskId: task.id })
      .sessions[0]!;
    const correction: Command = {
      type: "session.correct",
      id: active.id,
      revision: 0,
      taskRevision: 0,
      completed: true,
      remainingMinutes: null,
      notes: "",
    };
    assert.throws(() => store.execute(correction), /End this session/);
    store.execute({ type: "session.end", completed: false });
    store.execute({
      type: "session.review",
      id: active.id,
      remainingMinutes: null,
      notes: "Reviewed",
    });
    assert.throws(() => store.execute(correction), /changed/);
    store.execute({
      type: "task.update",
      id: task.id,
      input: { ...task, minutes: 40 },
      deadlineChangeApproved: false,
    });
    assert.throws(
      () => store.execute({ ...correction, revision: 1 }),
      /changed/,
    );
    store.execute({ type: "session.start", taskId: task.id });
    const before = store.snapshot();
    assert.throws(
      () => store.execute({ ...correction, revision: 1, taskRevision: 1 }),
      /newer session/,
    );
    assert.deepEqual(store.snapshot(), before);
  } finally {
    store.close();
  }
});
