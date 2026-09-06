import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import { planWeek } from "../planner";

const input = (
  classId: string,
  taskId: string | null,
  reviewDue: string | null,
) => ({
  classId,
  taskId,
  concept: "Friction",
  source: "Worksheet 4 #7",
  originalAttempt: "I added the forces without resolving components.",
  whatWentWrong: "The horizontal and vertical components were mixed.",
  correction: "Resolve each force into components before adding them.",
  helpUsed: "Teacher feedback",
  confidence: "medium" as const,
  reviewDue,
});

test("mistakes persist all required fields, update by revision, generate practice, influence plans, and can be forgotten", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-mistakes-"));
  let store = new DeskStore(join(directory, "desk.sqlite"));
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Worksheet 4",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    const created = store.execute({
      type: "mistake.create",
      input: input(classId, task.id, "2026-09-05T12:00:00.000Z"),
    }).mistakes[0]!;
    assert.equal(created.revision, 0);
    assert.deepEqual(created.practiceTaskIds, []);
    assert.equal(created.originalAttempt.includes("components"), true);
    assert.throws(
      () =>
        store.execute({
          type: "mistake.update",
          id: created.id,
          revision: 1,
          input: input(classId, task.id, null),
        }),
      /changed elsewhere/,
    );
    const updated = store.execute({
      type: "mistake.update",
      id: created.id,
      revision: 0,
      input: input(classId, task.id, null),
    }).mistakes[0]!;
    assert.equal(updated.reviewDue, null);
    const practiced = store.execute({
      type: "mistake.practice",
      id: updated.id,
      revision: updated.revision,
    });
    const practice = practiced.tasks.find(
      (item) => item.id === practiced.mistakes[0]!.practiceTaskIds[0],
    )!;
    assert.match(practice.title, /^Practice: Friction$/);
    assert.match(practice.notes, /Correction:/);
    assert.equal(practiced.mistakes[0]!.revision, 2);
    const plan = planWeek(
      [task, practice],
      new Date("2026-09-05T08:00:00.000Z"),
      practiced.planning,
      [],
      practiced,
    );
    assert.equal(plan.blocks[0]!.taskId, task.id);
    assert.equal(
      plan.blocks.some((block) => block.taskId === practice.id),
      true,
    );
    assert.match(plan.blocks[0]!.why, /mistake needs review/);
    store.close();
    store = new DeskStore(join(directory, "desk.sqlite"));
    assert.equal(store.snapshot().mistakes[0]!.practiceTaskIds.length, 1);
    const forgotten = store.execute({
      type: "mistake.forget",
      id: store.snapshot().mistakes[0]!.id,
      revision: store.snapshot().mistakes[0]!.revision,
    });
    assert.equal(forgotten.mistakes.length, 0);
    assert.equal(forgotten.tasks.length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mistakes cannot link a task from another class", () => {
  const store = new DeskStore(":memory:");
  try {
    const first = store.execute({ type: "class.create", name: "Physics" });
    const second = store.execute({ type: "class.create", name: "History" });
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Essay",
        classId: second.classes.at(-1)!.id,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    assert.throws(
      () =>
        store.execute({
          type: "mistake.create",
          input: input(first.classes[0]!.id, task.id, null),
        }),
      /linked task must belong/,
    );
  } finally {
    store.close();
  }
});
