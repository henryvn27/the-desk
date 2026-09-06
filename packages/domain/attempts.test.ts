import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("attempts persist explicit results, update linked concept evidence, and forget by revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-attempts-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const taskId = store
      .execute({
        type: "task.create",
        input: {
          title: "Kinematics worksheet",
          classId,
          dueAt: null,
          minutes: 30,
          resource: null,
          notes: "",
          deadlineConfirmed: true,
        },
      })
      .tasks.at(-1)!.id;
    const concept = store.execute({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskId],
        name: "Acceleration",
        status: "learning",
        preparedness: "developing",
        retentionMode: "course",
        reviewDue: null,
        attempts: 0,
        unaidedCorrect: 0,
        unaidedTotal: 0,
        hintCount: 0,
        lastReviewedAt: null,
        evidenceNote: "",
      },
    }).concepts[0]!;
    const created = store.execute({
      type: "attempt.create",
      input: {
        classId,
        taskId,
        conceptIds: [concept.id],
        result: "correct",
        unaided: true,
        hintCount: 0,
        notes: "Set up the equation independently.",
        attemptedAt: "2026-09-05T12:00:00.000Z",
      },
    }).attempts[0]!;
    assert.equal(created.revision, 0);
    assert.equal(store.snapshot().concepts[0]!.attempts, 1);
    assert.equal(store.snapshot().concepts[0]!.unaidedCorrect, 1);
    assert.equal(store.snapshot().concepts[0]!.unaidedTotal, 1);
    assert.throws(
      () =>
        store.execute({
          type: "attempt.update",
          id: created.id,
          revision: 4,
          input: {
            classId,
            taskId,
            conceptIds: [concept.id],
            result: "correct",
            unaided: true,
            hintCount: 0,
            notes: "stale",
            attemptedAt: "2026-09-05T12:00:00.000Z",
          },
        }),
      /changed elsewhere/,
    );
    const updated = store.execute({
      type: "attempt.update",
      id: created.id,
      revision: created.revision,
      input: {
        classId,
        taskId,
        conceptIds: [concept.id],
        result: "incorrect",
        unaided: false,
        hintCount: 2,
        notes: "Needed a hint to choose the sign.",
        attemptedAt: "2026-09-05T13:00:00.000Z",
      },
    }).attempts[0]!;
    assert.equal(updated.revision, 1);
    assert.equal(store.snapshot().concepts[0]!.attempts, 1);
    assert.equal(store.snapshot().concepts[0]!.unaidedCorrect, 0);
    assert.equal(store.snapshot().concepts[0]!.unaidedTotal, 0);
    assert.equal(store.snapshot().concepts[0]!.hintCount, 2);
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().attempts.length, 1);
    assert.equal(store.snapshot().attempts[0]!.notes, updated.notes);
    const forgotten = store.execute({
      type: "attempt.forget",
      id: updated.id,
      revision: updated.revision,
    });
    assert.equal(forgotten.attempts.length, 0);
    assert.equal(forgotten.concepts[0]!.attempts, 0);
    assert.equal(forgotten.tasks.length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
