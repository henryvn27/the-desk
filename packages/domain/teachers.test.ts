import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("teachers persist class links, connect to evidence, and protect linked identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-teachers-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const physics = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const history = store.execute({ type: "class.create", name: "History" })
      .classes[1]!;
    const task = store.execute({
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
    const teacher = store.execute({
      type: "teacher.create",
      input: {
        name: "Dr. Rivera",
        email: "rivera@example.edu",
        notes: "Physics instructor",
        classIds: [physics.id, history.id, physics.id],
      },
    }).teachers[0]!;
    assert.deepEqual(teacher.classIds, [physics.id, history.id]);
    let evidence = store.execute({
      type: "evidence.create",
      input: {
        classId: physics.id,
        teacherId: teacher.id,
        assessmentId: null,
        taskId: task.id,
        title: "Teacher feedback",
        kind: "teacher-feedback",
        source: "manual",
        scoreEarned: null,
        scorePossible: null,
        teacherComments: "Use units.",
        rubric: "",
        observations: "",
        conceptIds: [],
        includeInTeacherModeling: true,
        capturedAt: "2026-09-06T12:00:00.000Z",
      },
    }).teacherEvidence[0]!;
    assert.equal(evidence.teacherId, teacher.id);
    assert.throws(
      () =>
        store.execute({
          type: "teacher.update",
          id: teacher.id,
          revision: teacher.revision,
          input: {
            name: "Dr. Rivera",
            email: "rivera@example.edu",
            notes: "Moved",
            classIds: [history.id],
          },
        }),
      /linked.*evidence/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "teacher.forget",
          id: teacher.id,
          revision: teacher.revision,
        }),
      /linked.*evidence/,
    );
    const updated = store.execute({
      type: "teacher.update",
      id: teacher.id,
      revision: teacher.revision,
      input: {
        name: "Dr. Rivera",
        email: "rivera@example.edu",
        notes: "Office hours Thursday",
        classIds: [physics.id, history.id],
      },
    }).teachers[0]!;
    assert.equal(updated.revision, 1);
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().teachers[0]!.notes, "Office hours Thursday");
    const unlinked = store.execute({
      type: "evidence.update",
      id: evidence.id,
      revision: evidence.revision,
      input: {
        classId: physics.id,
        teacherId: null,
        assessmentId: null,
        taskId: task.id,
        title: "Teacher feedback",
        kind: "teacher-feedback",
        source: "manual",
        scoreEarned: null,
        scorePossible: null,
        teacherComments: "Use units.",
        rubric: "",
        observations: "",
        conceptIds: [],
        includeInTeacherModeling: true,
        capturedAt: "2026-09-06T12:00:00.000Z",
      },
    }).teacherEvidence[0]!;
    assert.equal(unlinked.teacherId, null);
    evidence = store.execute({
      type: "evidence.update",
      id: unlinked.id,
      revision: unlinked.revision,
      input: {
        classId: physics.id,
        teacherId: updated.id,
        assessmentId: null,
        taskId: task.id,
        title: "Teacher feedback",
        kind: "teacher-feedback",
        source: "manual",
        scoreEarned: null,
        scorePossible: null,
        teacherComments: "Use units.",
        rubric: "",
        observations: "",
        conceptIds: [],
        includeInTeacherModeling: true,
        capturedAt: "2026-09-06T12:00:00.000Z",
      },
    }).teacherEvidence[0]!;
    assert.equal(evidence.teacherId, updated.id);
    store.execute({
      type: "evidence.forget",
      id: evidence.id,
      revision: evidence.revision,
    });
    const forgotten = store.execute({
      type: "teacher.forget",
      id: updated.id,
      revision: updated.revision,
    });
    assert.equal(forgotten.teachers.length, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("teacher identity is class-local and duplicate names are rejected", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "English" })
      .classes[0]!.id;
    store.execute({
      type: "teacher.create",
      input: { name: "Ms. Lee", email: null, notes: "", classIds: [classId] },
    });
    assert.throws(
      () =>
        store.execute({
          type: "teacher.create",
          input: {
            name: "ms. lee",
            email: null,
            notes: "Duplicate",
            classIds: [classId],
          },
        }),
      /already exists/,
    );
  } finally {
    store.close();
  }
});
