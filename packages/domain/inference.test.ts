import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import { durationMemories, learningSessions } from "../learning/memory";
test("duration memory requires repeated evidence and confirmation; disable, forget and clear preserve explicit history", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-inference-"));
  let store = new DeskStore(join(dir, "desk.sqlite"));
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    store.execute({ type: "planning.mode", mode: "suggest" });
    store.execute({
      type: "planning.preferences",
      input: {
        studyStart: "00:00",
        sleepCutoff: "23:59",
        bufferPercent: 15,
        studyDays: [0, 1, 2, 3, 4, 5, 6],
      },
    });
    for (let i = 0; i < 3; i++) {
      const task = store
        .execute({
          type: "task.create",
          input: {
            title: "Practice",
            classId,
            minutes: 30,
            dueAt: null,
            resource: null,
            notes: "",
            deadlineConfirmed: true,
          },
        })
        .tasks.at(-1)!;
      const start = new Date(`2026-09-0${i + 1}T12:00:00Z`);
      const session = store
        .execute({ type: "session.start", taskId: task.id }, start)
        .sessions.at(-1)!;
      store.execute(
        { type: "session.end", completed: true },
        new Date(+start + 60 * 60000),
      );
      store.execute({
        type: "session.review",
        id: session.id,
        notes: "Synthetic",
        remainingMinutes: null,
      });
      if (i < 2) assert.equal(durationMemories(store.snapshot()).length, 0);
    }
    assert.equal(store.snapshot().memories.length, 0);
    const candidate = durationMemories(store.snapshot())[0]!;
    const confirm = {
      type: "memory.confirm" as const,
      classId,
      workKind: candidate.workKind,
      basis: candidate.basis,
    };
    store.execute({ type: "memory.inference", enabled: false });
    assert.equal(durationMemories(store.snapshot()).length, 0);
    assert.equal(learningSessions(store.snapshot()).length, 0);
    assert.throws(() => store.execute(confirm));
    store.execute({ type: "memory.inference", enabled: true });
    assert.throws(() => store.execute({ ...confirm, basis: "stale" }));
    const memory = store.execute(confirm).memories[0]!;
    assert.equal(memory.origin, "inferred");
    assert.equal(memory.evidence?.samples, 3);
    assert.throws(() => store.execute(confirm));
    store.execute({
      type: "memory.update",
      id: memory.id,
      revision: 0,
      input: { text: "Edited pattern", category: "duration", classId },
    });
    assert.equal(store.snapshot().memories[0]!.origin, "inferred");
    store.execute({
      type: "memory.create",
      input: {
        text: "Explicit preference",
        category: "preference",
        classId: null,
      },
    });
    const before = store.snapshot();
    store.execute({ type: "memory.clear-inferred" });
    assert.equal(store.snapshot().memories.length, 1);
    assert.equal(store.snapshot().memories[0]!.origin, "explicit");
    assert.deepEqual(store.snapshot().sessions, before.sessions);
    assert.equal(durationMemories(store.snapshot()).length, 0);
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.equal(durationMemories(store.snapshot()).length, 0);
    assert.equal(store.snapshot().inference.excludedSessionIds.length, 3);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearing part of a task history excludes the whole task from relearning", () => {
  const sessions = [
    { id: "old", taskId: "same" },
    { id: "new", taskId: "same" },
    { id: "fresh", taskId: "fresh-task" },
  ] as import("./contracts").StudySession[];
  assert.deepEqual(
    learningSessions({
      sessions,
      inference: { enabled: true, excludedSessionIds: ["old"] },
    }).map((s) => s.id),
    ["fresh"],
  );
});
