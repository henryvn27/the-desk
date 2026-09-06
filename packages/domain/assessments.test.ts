import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("assessments persist first-class type, links and grade context with revisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-assessments-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const taskId = store
      .execute({
        type: "task.create",
        input: {
          title: "Kinematics review",
          classId,
          dueAt: null,
          minutes: 30,
          resource: null,
          notes: "",
          deadlineConfirmed: true,
        },
      })
      .tasks.at(-1)!.id;
    const categoryId = store.execute({
      type: "grade.category",
      input: { classId, name: "Tests", weight: 50 },
    }).gradeCategories[0]!.id;
    const created = store.execute({
      type: "assessment.create",
      input: {
        classId,
        title: "Kinematics test",
        kind: "test",
        taskIds: [taskId, taskId],
        dueAt: "2026-09-08T13:00:00.000Z",
        gradeCategoryId: categoryId,
        notes: "Bring the formula sheet.",
      },
    }).assessments[0]!;
    assert.equal(created.revision, 0);
    assert.deepEqual(created.taskIds, [taskId]);
    assert.throws(
      () =>
        store.execute({
          type: "assessment.update",
          id: created.id,
          revision: 3,
          input: {
            classId,
            title: "Stale test",
            kind: "quiz",
            taskIds: [taskId],
            dueAt: null,
            gradeCategoryId: categoryId,
            notes: "",
          },
        }),
      /changed elsewhere/,
    );
    const updated = store.execute({
      type: "assessment.update",
      id: created.id,
      revision: created.revision,
      input: {
        classId,
        title: "Kinematics midterm",
        kind: "midterm",
        taskIds: [taskId],
        dueAt: "2026-09-09T13:00:00.000Z",
        gradeCategoryId: categoryId,
        notes: "Updated scope.",
      },
    }).assessments[0]!;
    assert.equal(updated.revision, 1);
    assert.equal(updated.kind, "midterm");
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().assessments[0]!.title, "Kinematics midterm");
    const forgotten = store.execute({
      type: "assessment.forget",
      id: updated.id,
      revision: updated.revision,
    });
    assert.equal(forgotten.assessments.length, 0);
    assert.equal(forgotten.tasks.length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
