import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot, Task } from "../domain/contracts";
import { deriveHome } from "./home";

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const planning = {
  studyStart: "08:00",
  sleepCutoff: "22:00",
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  bufferPercent: 15,
} as const;

function task(
  key: string,
  title: string,
  dueAt: string | null,
  options: Partial<Task> = {},
): Task {
  return {
    id: id(key),
    title,
    classId: id("100"),
    minutes: 45,
    dueAt,
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
    classes: [],
    ...extra,
  } as unknown as Snapshot;
}

test("Home follows the Planner recommendation and keeps today separate from future work", () => {
  const now = new Date("2026-09-07T09:00:00.000Z");
  const result = deriveHome(snapshot([
    task("one", "Calculus practice", "2026-09-08T22:00:00.000Z"),
    task("two", "Physics reading", "2026-09-10T22:00:00.000Z"),
  ]), now);
  assert.equal(result.next?.taskId, id("one"));
  assert.equal(result.today.length, result.plan.blocks.length - 1);
  assert.equal(result.attention.length, 0);
});

test("Home still recommends the next executable block on a weekend", () => {
  const now = new Date("2026-09-12T10:00:00.000Z");
  const result = deriveHome(snapshot([
    task("monday", "Monday worksheet", "2026-09-14T22:00:00.000Z"),
  ], { planning: { ...planning, studyDays: [1, 2, 3, 4, 5] } }), now);
  assert.equal(result.today.length, 0);
  assert.equal(result.next?.taskId, id("monday"));
});

test("Needs attention contains decisions and material overload, not every unscheduled item", () => {
  const now = new Date("2026-09-07T18:00:00.000Z");
  const uncertain = task("uncertain", "Uncertain project", "2026-09-09T22:00:00.000Z", { deadlineConfirmed: false });
  const result = deriveHome(snapshot([
    uncertain,
    task("required", "Required lab", "2026-09-08T22:00:00.000Z", { minutes: 2400 }),
    task("optional", "Optional review", null, { workKind: "optional-review" }),
  ], { planning: { ...planning, studyStart: "18:00", sleepCutoff: "19:00", studyDays: [1] } }), now);
  assert.ok(result.attention.some((item) => item.kind === "decision" && item.taskId === uncertain.id));
  assert.ok(result.attention.some((item) => item.kind === "overload"));
  assert.equal(result.attention.some((item) => item.taskId === id("optional")), false);
});

test("Missed sessions and unresolved authority conflicts are actionable attention", () => {
  const taskValue = task("missed", "Physics lab", "2026-09-08T22:00:00.000Z");
  const session = {
    id: id("500"),
    taskId: taskValue.id,
    startedAt: "2026-09-06T18:00:00.000Z",
    pausedAt: null,
    pausedMs: 0,
    endedAt: "2026-09-06T18:30:00.000Z",
    actualMinutes: 30,
    completionReported: false,
  };
  const claim = {
    id: id("600"),
    classId: taskValue.classId,
    taskId: taskValue.id,
    fact: "due-date" as const,
    value: "2026-09-08T20:00:00.000Z",
    authorityKind: "teacher-update" as const,
    confidence: "high" as const,
    sourceLabel: "Teacher portal",
    details: "",
    sourceId: null,
    evidenceId: null,
    capturedAt: "2026-09-06T08:00:00.000Z",
    revision: 0,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
  };
  const result = deriveHome(snapshot([taskValue], { sessions: [session], authorityClaims: [claim] }), new Date("2026-09-07T08:00:00.000Z"));
  assert.ok(result.attention.some((item) => item.kind === "conflict"));
  assert.ok(result.attention.some((item) => item.kind === "session-review"));
});

test("Continue keeps an exact Note block backlink when one exists", () => {
  const taskValue = task("note", "Read the source", "2026-09-12T22:00:00.000Z");
  const canvasId = id("700");
  const blockId = "note-block-7";
  const result = deriveHome(snapshot([taskValue], {
    canvases: [{ id: canvasId, taskId: taskValue.id, title: "Physics notes", createdAt: "2026-09-06T08:00:00.000Z", updatedAt: "2026-09-07T07:30:00.000Z", revision: 1 }],
    sources: [{ id: id("800"), title: "Handout", text: "", classIds: [taskValue.classId], taskIds: [taskValue.id], createdAt: "2026-09-06T08:00:00.000Z", authority: "user-provided-text", annotations: [{ id: id("801"), sourceId: id("800"), sourceRevision: 0, text: "passage", comment: "", location: { startOffset: 0, endOffset: 7 }, noteRefs: [{ canvasId, blockId }], createdAt: "2026-09-07T07:00:00.000Z", updatedAt: "2026-09-07T07:00:00.000Z", revision: 0 }] }],
  }), new Date("2026-09-07T08:00:00.000Z"));
  const note = result.continue.find((item) => item.kind === "note");
  assert.equal(note?.canvasId, canvasId);
  assert.equal(note?.blockId, blockId);
});

test("Recent material plan changes collapse to one calm explanation", () => {
  const first = task("old", "Physics", "2026-09-09T22:00:00.000Z");
  const change = {
    id: id("900"),
    createdAt: "2026-09-07T08:00:00.000Z",
    appliedAt: "2026-09-07T08:00:00.000Z",
    expiresAt: "2026-09-07T08:02:00.000Z",
    replaced: [{ id: id("901"), taskId: first.id, start: "2026-09-07T10:00:00.000Z", end: "2026-09-07T10:45:00.000Z", minutes: 45, why: "", locked: false, revision: 0, createdAt: "2026-09-07T08:00:00.000Z", updatedAt: "2026-09-07T08:00:00.000Z" }],
    added: [{ id: id("902"), taskId: first.id, start: "2026-09-07T10:20:00.000Z", end: "2026-09-07T11:05:00.000Z", minutes: 45, why: "", locked: false, revision: 0, createdAt: "2026-09-07T08:00:00.000Z", updatedAt: "2026-09-07T08:00:00.000Z" }],
    kept: [],
    unscheduled: [],
  };
  const result = deriveHome(snapshot([first], { planChanges: [change] }), new Date("2026-09-07T12:00:00.000Z"));
  assert.match(result.planChange?.text ?? "", /Physics moved 20 minutes later/);
});
