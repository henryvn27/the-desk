import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot, Task } from "../domain/contracts";
import { deriveNextAction } from "./next-action";

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const planning = {
  studyStart: "08:00",
  sleepCutoff: "22:00",
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  bufferPercent: 15,
} as const;

function task(key: string, title: string, options: Partial<Task> = {}): Task {
  return {
    id: id(key),
    title,
    classId: id("100"),
    minutes: 45,
    dueAt: "2026-09-08T22:00:00.000Z",
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: false,
    createdAt: "2026-09-01T08:00:00.000Z",
    revision: 0,
    ...options,
  };
}

function snapshot(tasks: Task[], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    tasks,
    planning,
    studyBlocks: [],
    sessions: [],
    authorityClaims: [],
    authorityResolutions: [],
    syncConflicts: [],
    planChanges: [],
    assessments: [],
    canvases: [],
    sources: [],
    classes: [{ id: id("100"), name: "AP Physics C" }],
    concepts: [],
    attempts: [],
    mistakes: [],
    teacherEvidence: [],
    ...extra,
  } as unknown as Snapshot;
}

const now = new Date("2026-09-07T09:00:00.000Z");

test("Next Action uses the planner's executable task and explains the decision", () => {
  const next = deriveNextAction(snapshot([task("1", "Momentum worksheet")]), now);
  assert.equal(next.kind, "start-task");
  assert.equal(next.taskId, id("1"));
  assert.equal(next.classId, id("100"));
  assert.equal(next.estimatedMinutes, 45);
  assert.equal(next.actions[0]?.id, "start");
  assert.ok(next.evidence.some((item) => /Planner selected/i.test(item)));
  assert.ok(next.confidence > 0.9);
});

test("an active session takes precedence over a newly computed task plan", () => {
  const taskValue = task("2", "Lab report");
  const next = deriveNextAction(
    snapshot([taskValue], {
      sessions: [{
        id: id("200"),
        taskId: taskValue.id,
        startedAt: "2026-09-07T08:30:00.000Z",
        pausedAt: null,
        pausedMs: 0,
        endedAt: null,
        actualMinutes: null,
      }],
    }),
    now,
  );
  assert.equal(next.kind, "active-session");
  assert.equal(next.sessionId, id("200"));
  assert.equal(next.actions[0]?.id, "resume");
  assert.equal(next.urgency, "now");
});

test("a deadline decision is actionable when no executable plan exists", () => {
  const next = deriveNextAction(
    snapshot([task("3", "Unclear worksheet", { deadlineConfirmed: false })]),
    now,
  );
  assert.equal(next.kind, "resolve-attention");
  assert.equal(next.taskId, id("3"));
  assert.equal(next.actions[0]?.id, "review");
  assert.match(next.reason, /uncertain/i);
});

test("overdue work resolves before a lower urgency study objective", () => {
  const next = deriveNextAction(
    snapshot([task("4", "Overdue lab", { dueAt: "2026-09-06T22:00:00.000Z" })]),
    now,
  );
  assert.equal(next.kind, "resolve-attention");
  assert.equal(next.taskId, id("4"));
  assert.equal(next.urgency, "today");
  assert.match(next.reason, /Due/i);
});

test("a weak concept becomes a review objective only after task attention is clear", () => {
  const conceptId = id("301");
  const next = deriveNextAction(
    snapshot([], {
      concepts: [{
        id: conceptId,
        classId: id("100"),
        taskIds: [],
        name: "Sign conventions",
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
        revision: 0,
        createdAt: "2026-09-01T08:00:00.000Z",
        updatedAt: "2026-09-01T08:00:00.000Z",
      }],
    }),
    now,
  );
  assert.equal(next.kind, "study-objective");
  assert.equal(next.conceptId, conceptId);
  assert.equal(next.classId, id("100"));
  assert.ok(next.evidence.some((item) => /checked work/i.test(item)));
});

test("empty workspace recommends durable capture instead of inventing work", () => {
  const next = deriveNextAction(snapshot([]), now);
  assert.equal(next.kind, "capture");
  assert.equal(next.actions[0]?.id, "capture");
  assert.equal(next.taskId, undefined);
  assert.ok(next.evidence.some((item) => /capture/i.test(item)));
});
