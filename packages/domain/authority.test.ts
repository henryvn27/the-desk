import { test } from "node:test";
import assert from "node:assert/strict";
import { DeskStore } from "./store";

test("authority claims preserve due-date conflicts until the student resolves them", () => {
  const store = new DeskStore(":memory:");
  try {
    const course = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Friction lab",
        classId: course.id,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: false,
      },
    }).tasks[0]!;
    const first = store.execute({
      type: "authority.claim.create",
      input: {
        classId: course.id,
        taskId: task.id,
        fact: "due-date",
        value: "2026-09-09T23:00:00.000Z",
        authorityKind: "syllabus",
        confidence: "high",
        sourceLabel: "Syllabus",
        details: "The weekly syllabus says Wednesday.",
        sourceId: null,
        evidenceId: null,
        capturedAt: "2026-09-05T12:00:00.000Z",
      },
    }).authorityClaims[0]!;
    const second = store
      .execute({
        type: "authority.claim.create",
        input: {
          classId: course.id,
          taskId: task.id,
          fact: "due-date",
          value: "2026-09-08T23:00:00.000Z",
          authorityKind: "live-lms",
          confidence: "medium",
          sourceLabel: "Classroom",
          details: "The current assignment says Tuesday.",
          sourceId: null,
          evidenceId: null,
          capturedAt: "2026-09-05T13:00:00.000Z",
        },
      })
      .authorityClaims.at(-1)!;
    assert.equal(store.snapshot().tasks[0]!.dueAt, null);
    assert.equal(store.snapshot().authorityClaims.length, 2);
    assert.throws(
      () =>
        store.execute({
          type: "authority.resolve",
          taskId: task.id,
          claimId: second.id,
          claimRevision: second.revision,
          taskRevision: task.revision ?? 0,
          resolutionApproved: false,
        }),
      /Choose an authority claim/,
    );
    const resolved = store.execute({
      type: "authority.resolve",
      taskId: task.id,
      claimId: second.id,
      claimRevision: second.revision,
      taskRevision: task.revision ?? 0,
      resolutionApproved: true,
    });
    assert.equal(resolved.tasks[0]!.dueAt, second.value);
    assert.equal(resolved.tasks[0]!.deadlineConfirmed, true);
    assert.equal(resolved.authorityResolutions[0]!.claimId, second.id);
    assert.throws(
      () =>
        store.execute({
          type: "authority.claim.forget",
          id: second.id,
          revision: second.revision,
        }),
      /another claim/,
    );
    const forgotten = store.execute({
      type: "authority.claim.forget",
      id: first.id,
      revision: first.revision,
    });
    assert.equal(forgotten.authorityClaims.length, 1);
    assert.equal(forgotten.tasks[0]!.dueAt, second.value);
  } finally {
    store.close();
  }
});

test("authority resolution rejects stale task or claim revisions", () => {
  const store = new DeskStore(":memory:");
  try {
    const course = store.execute({ type: "class.create", name: "History" })
      .classes[0]!;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Primary source",
        classId: course.id,
        dueAt: null,
        minutes: 20,
        resource: null,
        notes: "",
        deadlineConfirmed: false,
      },
    }).tasks[0]!;
    const claim = store.execute({
      type: "authority.claim.create",
      input: {
        classId: course.id,
        taskId: task.id,
        fact: "due-date",
        value: "2026-09-10T23:00:00.000Z",
        authorityKind: "teacher-update",
        confidence: "high",
        sourceLabel: "Teacher update",
        details: "Due Thursday.",
        sourceId: null,
        evidenceId: null,
        capturedAt: "2026-09-05T12:00:00.000Z",
      },
    }).authorityClaims[0]!;
    const edited = store.execute({
      type: "authority.claim.update",
      id: claim.id,
      revision: claim.revision,
      input: {
        classId: course.id,
        taskId: task.id,
        fact: "due-date",
        value: "2026-09-11T23:00:00.000Z",
        authorityKind: "teacher-update",
        confidence: "high",
        sourceLabel: "Teacher update",
        details: "Moved to Friday.",
        sourceId: null,
        evidenceId: null,
        capturedAt: "2026-09-05T12:00:00.000Z",
      },
    }).authorityClaims[0]!;
    assert.throws(
      () =>
        store.execute({
          type: "authority.resolve",
          taskId: task.id,
          claimId: claim.id,
          claimRevision: claim.revision,
          taskRevision: task.revision ?? 0,
          resolutionApproved: true,
        }),
      /claim changed elsewhere/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "authority.resolve",
          taskId: task.id,
          claimId: edited.id,
          claimRevision: edited.revision,
          taskRevision: task.revision! + 1,
          resolutionApproved: true,
        }),
      /assignment changed elsewhere/,
    );
  } finally {
    store.close();
  }
});
