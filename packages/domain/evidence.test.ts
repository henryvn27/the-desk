import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import { teacherEvidenceInput } from "./contracts";

test("teacher evidence persists scored feedback, modeling choice and links", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-evidence-"));
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
    const assessmentId = store.execute({
      type: "assessment.create",
      input: {
        classId,
        title: "Kinematics test",
        kind: "test",
        taskIds: [taskId],
        dueAt: null,
        gradeCategoryId: null,
        notes: "",
      },
    }).assessments[0]!.id;
    const conceptId = store.execute({
      type: "concept.create",
      input: {
        classId,
        taskIds: [taskId],
        name: "Sign conventions",
        status: "developing",
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
    }).concepts[0]!.id;
    const created = store.execute({
      type: "evidence.create",
      input: {
        classId,
        assessmentId,
        taskId,
        title: "Marked kinematics test",
        kind: "graded-work",
        source: "manual",
        scoreEarned: 8,
        scorePossible: 10,
        teacherComments: "Show the sign convention.",
        rubric: "Method and units",
        observations: "Lost points on units.",
        conceptIds: [conceptId, conceptId],
        includeInTeacherModeling: false,
        capturedAt: "2026-09-05T15:00:00.000Z",
      },
    }).teacherEvidence[0]!;
    assert.equal(created.authority, "teacher-reported");
    assert.deepEqual(created.conceptIds, [conceptId]);
    assert.equal(created.revision, 0);
    assert.throws(
      () =>
        store.execute({
          type: "evidence.update",
          id: created.id,
          revision: 8,
          input: {
            classId,
            assessmentId,
            taskId,
            title: "Stale evidence",
            kind: "teacher-feedback",
            source: "manual",
            scoreEarned: null,
            scorePossible: null,
            teacherComments: "",
            rubric: "",
            observations: "",
            conceptIds: [],
            includeInTeacherModeling: true,
            capturedAt: "2026-09-05T15:00:00.000Z",
          },
        }),
      /changed elsewhere/,
    );
    const updated = store.execute({
      type: "evidence.update",
      id: created.id,
      revision: created.revision,
      input: {
        classId,
        assessmentId,
        taskId,
        title: "Marked kinematics test",
        kind: "teacher-feedback",
        source: "manual",
        scoreEarned: null,
        scorePossible: null,
        teacherComments: "Use units.",
        rubric: "",
        observations: "",
        conceptIds: [conceptId],
        includeInTeacherModeling: true,
        capturedAt: "2026-09-05T16:00:00.000Z",
      },
    }).teacherEvidence[0]!;
    assert.equal(updated.revision, 1);
    store.close();
    store = new DeskStore(path);
    assert.equal(
      store.snapshot().teacherEvidence[0]!.includeInTeacherModeling,
      true,
    );
    const forgotten = store.execute({
      type: "evidence.forget",
      id: updated.id,
      revision: updated.revision,
    });
    assert.equal(forgotten.teacherEvidence.length, 0);
    assert.equal(forgotten.assessments.length, 1);
    assert.equal(forgotten.concepts.length, 1);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("teacher evidence rejects a partial score pair", () => {
  assert.throws(
    () =>
      teacherEvidenceInput.parse({
        classId: "00000000-0000-4000-8000-000000000001",
        assessmentId: null,
        taskId: null,
        title: "Feedback",
        kind: "teacher-feedback",
        source: "manual",
        scoreEarned: 8,
        scorePossible: null,
        teacherComments: "",
        rubric: "",
        observations: "",
        conceptIds: [],
        includeInTeacherModeling: true,
        capturedAt: "2026-09-05T15:00:00.000Z",
      }),
    /both score values/,
  );
});
