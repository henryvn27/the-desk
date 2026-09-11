import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import type { Command } from "./contracts";

function createSession(store: DeskStore) {
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
  const concept = store.execute({
    type: "concept.create",
    input: {
      classId,
      taskIds: [task.id],
      name: "Components",
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
  const secondConcept = store.execute({
    type: "concept.create",
    input: {
      classId,
      taskIds: [task.id],
      name: "Resultants",
      status: "strong",
      preparedness: "ready",
      retentionMode: "course",
      reviewDue: null,
      attempts: 0,
      unaidedCorrect: 0,
      unaidedTotal: 0,
      hintCount: 0,
      lastReviewedAt: null,
      evidenceNote: "Keep the existing student note.",
    },
  }).concepts.at(-1)!;
  store.execute(
    { type: "session.start", taskId: task.id },
    new Date("2026-09-06T10:00:00.000Z"),
  );
  const session = store.execute(
    { type: "session.end", completed: false },
    new Date("2026-09-06T10:25:00.000Z"),
  ).sessions[0]!;
  return { classId, task, concept, secondConcept, session };
}

test("session evidence atomically records attempts and an optional mistake without mastery claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-session-evidence-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const { classId, task, concept, secondConcept, session } = createSession(store);
    const command: Command = {
      type: "session.evidence",
      id: session.id,
      revision: session.revision ?? 0,
      taskRevision: task.revision ?? 0,
      input: {
        notes: "Set up both components; check the sign on the y-axis.",
        remainingMinutes: 15,
        attempts: [
          {
            classId,
            taskId: task.id,
            conceptIds: [concept.id],
            result: "correct",
            unaided: true,
            hintCount: 0,
            notes: "Explained the x component without a hint.",
            attemptedAt: "2026-09-06T10:20:00.000Z",
          },
          {
            classId,
            taskId: task.id,
            conceptIds: [secondConcept.id],
            result: "partial",
            unaided: false,
            hintCount: 1,
            notes: "Needed a prompt to resolve the resultant.",
            attemptedAt: "2026-09-06T10:23:00.000Z",
          },
        ],
        mistake: {
          classId,
          taskId: task.id,
          concept: "Sign convention",
          source: "Session: Vectors",
          originalAttempt: "I treated the downward component as positive.",
          whatWentWrong: "I did not set the coordinate direction first.",
          correction: "Write the axis convention before resolving forces.",
          helpUsed: "A worked example",
          confidence: "medium",
          reviewDue: null,
        },
      },
    };
    const saved = store.execute(
      command,
      new Date("2026-09-06T10:30:00.000Z"),
    );
    const reviewed = saved.sessions.find((item) => item.id === session.id)!;
    assert.equal(reviewed.review?.notes, command.input.notes);
    assert.equal(reviewed.review?.remainingMinutes, 15);
    assert.equal(reviewed.revision, 1);
    assert.equal(saved.tasks.find((item) => item.id === task.id)?.minutes, 15);
    assert.equal(saved.attempts.length, 2);
    assert.equal(saved.mistakes.length, 1);
    assert.equal(saved.mistakes[0]!.taskId, task.id);
    const savedConcept = saved.concepts.find((item) => item.id === concept.id)!;
    assert.equal(savedConcept.attempts, 1);
    assert.equal(savedConcept.unaidedCorrect, 1);
    assert.equal(savedConcept.unaidedTotal, 1);
    assert.equal(savedConcept.status, concept.status);
    assert.equal(savedConcept.preparedness, concept.preparedness);
    assert.equal(savedConcept.reviewDue, concept.reviewDue);
    assert.equal(savedConcept.evidenceNote, concept.evidenceNote);
    const queuedOperations = new Set(
      saved.outbox.map((operation) => operation.operation),
    );
    for (const operation of [
      "session.evidence",
      "task.remaining-time",
      "attempt.create",
      "concept.evidence",
      "mistake.create",
    ])
      assert.equal(queuedOperations.has(operation), true);

    store.close();
    store = new DeskStore(path);
    const reopened = store.snapshot();
    assert.equal(reopened.attempts.length, 2);
    assert.equal(reopened.mistakes[0]!.concept, "Sign convention");
    assert.equal(
      reopened.sessions.find((item) => item.id === session.id)?.review?.notes,
      command.input.notes,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("session evidence rejects stale or cross-task writes without partial records", () => {
  const store = new DeskStore(":memory:");
  try {
    const { classId, task, concept, session } = createSession(store);
    const input = {
      notes: "Recorded after checking one example.",
      remainingMinutes: null,
      attempts: [
        {
          classId,
          taskId: task.id,
          conceptIds: [concept.id],
          result: "unknown" as const,
          unaided: true,
          hintCount: 0,
          notes: "Need to check the final answer.",
          attemptedAt: "2026-09-06T10:24:00.000Z",
        },
      ],
      mistake: null,
    };
    const saved = store.execute({
      type: "session.evidence",
      id: session.id,
      revision: 0,
      taskRevision: task.revision ?? 0,
      input,
    });
    const beforeStale = store.snapshot();
    assert.throws(
      () =>
        store.execute({
          type: "session.evidence",
          id: session.id,
          revision: 0,
          taskRevision: task.revision ?? 0,
          input,
        }),
      /changed/,
    );
    assert.deepEqual(store.snapshot(), beforeStale);
    assert.equal(saved.attempts.length, 1);

    const otherClass = store.execute({ type: "class.create", name: "History" })
      .classes.at(-1)!.id;
    const beforeInvalid = store.snapshot();
    assert.throws(
      () =>
        store.execute({
          type: "session.evidence",
          id: session.id,
          revision: 1,
          taskRevision: task.revision ?? 0,
          input: {
            ...input,
            attempts: [
              {
                ...input.attempts[0]!,
                classId: otherClass,
              },
            ],
          },
        }),
      /session attempt must link/,
    );
    assert.deepEqual(store.snapshot(), beforeInvalid);
  } finally {
    store.close();
  }
});
