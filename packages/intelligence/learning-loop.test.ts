import { test } from "node:test";
import assert from "node:assert/strict";
import type { Attempt, Concept, Snapshot, Task } from "../domain/contracts";
import { buildTestOutPlan, deriveLearningLoop, deriveRemediations, learningOverrideText, packAvailableTime } from "./learning-loop";

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const now = new Date("2026-09-07T12:00:00.000Z");
const classId = id("100");

function task(key: string, title: string, options: Partial<Task> = {}): Task {
  return {
    id: id(key),
    title,
    classId,
    dueAt: null,
    minutes: 30,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: false,
    revision: 0,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...options,
  };
}

function concept(key: string, name: string, taskIds: string[], prerequisites: string[] = [], options: Partial<Concept> = {}): Concept {
  return {
    id: id(key),
    classId,
    taskIds,
    prerequisiteConceptIds: prerequisites,
    name,
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
    ...options,
  };
}

function attempt(key: string, conceptIds: string[], result: Attempt["result"], attemptedAt: string, taskId: string | null, options: Partial<Attempt> = {}): Attempt {
  return {
    id: id(key),
    classId,
    taskId,
    conceptIds,
    result,
    unaided: true,
    hintCount: 0,
    notes: "",
    attemptedAt,
    revision: 0,
    createdAt: attemptedAt,
    updatedAt: attemptedAt,
    ...options,
  };
}

function snapshot(extra: Partial<Snapshot> = {}): Snapshot {
  return {
    user: null,
    mistakes: [],
    memories: [],
    inference: { enabled: true, excludedSessionIds: [] },
    tutoringMode: "balanced",
    capturePolicy: "balanced",
    captureInbox: [],
    planningMode: "auto-plan",
    gradeCategories: [],
    gradeEntries: [],
    assessments: [],
    academicPeriods: [],
    spaces: [],
    tracks: [],
    units: [],
    teachers: [],
    teacherEvidence: [],
    authorityClaims: [],
    authorityResolutions: [],
    concepts: [],
    attempts: [],
    plans: [],
    planChanges: [],
    outbox: [],
    syncConflicts: [],
    studyBlocks: [],
    canvases: [],
    sources: [],
    classes: [{ id: classId, name: "AP Physics C", color: "#50705A" }],
    tasks: [],
    sessions: [],
    planning: { studyStart: "08:00", sleepCutoff: "22:00", studyDays: [0, 1, 2, 3, 4, 5, 6], bufferPercent: 15 },
    ...extra,
  };
}

test("a confirmed deadline beats a higher-value remediation when it is close", () => {
  const prerequisite = concept("101", "Vector components", []);
  const advanced = concept("102", "Projectile motion", [], [prerequisite.id]);
  const failures = [
    attempt("201", [advanced.id], "incorrect", "2026-09-06T10:00:00.000Z", null),
    attempt("202", [advanced.id], "partial", "2026-09-06T11:00:00.000Z", null),
  ];
  const urgent = task("301", "Submit lab", { dueAt: "2026-09-07T20:00:00.000Z", minutes: 20 });
  const state = snapshot({ tasks: [urgent], concepts: [prerequisite, advanced], attempts: failures });
  const projection = deriveLearningLoop(state, now);
  assert.equal(projection.nextBestAction.kind, "assignment");
  assert.equal(projection.nextBestAction.taskId, urgent.id);
  assert.match(projection.nextBestAction.reason.primary, /deadline/i);
  assert.ok(projection.remediations.length > 0);
});

test("repeated failure exposes the weakest prerequisite as a targeted remediation", () => {
  const prerequisite = concept("111", "Resolve vectors", []);
  const advanced = concept("112", "Projectile motion", [], [prerequisite.id]);
  const state = snapshot({
    concepts: [prerequisite, advanced],
    attempts: [
      attempt("211", [advanced.id], "incorrect", "2026-09-06T10:00:00.000Z", null),
      attempt("212", [advanced.id], "incorrect", "2026-09-06T11:00:00.000Z", null),
    ],
  });
  const [candidate] = deriveRemediations(state, now);
  assert.equal(candidate?.conceptId, prerequisite.id);
  assert.equal(candidate?.blockedConceptId, advanced.id);
  assert.match(candidate?.reason ?? "", /weakest prerequisite/i);
});

test("test-out creates a small source-aware check instead of silently treating review as mastery", () => {
  const work = task("401", "Momentum set");
  const conceptRecord = concept("402", "Momentum", [work.id], [], {
    preparedness: "ready",
    attempts: 2,
    unaidedCorrect: 2,
    unaidedTotal: 2,
    lastReviewedAt: "2026-09-01T12:00:00.000Z",
    reviewDue: "2026-09-07T11:00:00.000Z",
  });
  const sourceId = id("403");
  const state = snapshot({
    tasks: [work],
    concepts: [conceptRecord],
    sources: [{ id: sourceId, title: "Momentum notes", text: "Momentum and collisions", classIds: [classId], taskIds: [work.id], authority: "user-provided-text", createdAt: "2026-09-01T12:00:00.000Z", revision: 0 }],
  });
  const plan = buildTestOutPlan(state, conceptRecord.id, now, work.id);
  assert.equal(plan?.taskId, work.id);
  assert.equal(plan?.prompts.length, 2);
  assert.ok(plan?.sourceIds.includes(sourceId));
  assert.ok(plan?.prompts.every((prompt) => prompt.sourceIds.includes(sourceId)));
});

test("effective learning keeps tracked time separate from checked evidence", () => {
  const work = task("501", "Read the chapter");
  const state = snapshot({
    tasks: [work],
    sessions: [{ id: id("502"), taskId: work.id, startedAt: "2026-09-07T10:00:00.000Z", pausedAt: null, pausedMs: 0, endedAt: "2026-09-07T10:30:00.000Z", actualMinutes: 30, completionReported: true, review: { reviewedAt: "2026-09-07T10:31:00.000Z", notes: "Read", remainingMinutes: null } }],
  });
  const learning = deriveLearningLoop(state, now).effectiveLearning;
  assert.equal(learning.trackedMinutes, 30);
  assert.equal(learning.checkedAttempts, 0);
  assert.equal(learning.evidenceMinutes, 0);
  assert.match(learning.explanation, /checked outcome/i);
});

test("unfinished sessions are actionable loops rather than invisible history", () => {
  const work = task("601", "Finish derivation");
  const state = snapshot({
    tasks: [work],
    sessions: [{ id: id("602"), taskId: work.id, startedAt: "2026-09-07T09:00:00.000Z", pausedAt: null, pausedMs: 0, endedAt: "2026-09-07T09:20:00.000Z", actualMinutes: 20, completionReported: false }],
  });
  const loops = deriveLearningLoop(state, now).incompleteLoops;
  assert.ok(loops.some((loop) => loop.kind === "session-review" && loop.taskId === work.id));
});

test("available time packing uses the same next action and leaves an explicit transition buffer", () => {
  const work = task("701", "Problem set", { minutes: 30 });
  const state = snapshot({ tasks: [work] });
  const plan = packAvailableTime(state, 42, now);
  assert.equal(plan.availableMinutes, 42);
  assert.equal(plan.blocks[0]?.taskId, work.id);
  assert.ok(plan.blocks.some((block) => block.kind === "break") || plan.unusedMinutes > 0);
  assert.match(plan.explanation, /deadlines|learning/i);
});

test("a persisted user correction removes a weak concept from future recommendations", () => {
  const conceptRecord = concept("801", "Excluded chapter", [] , [], { reviewDue: "2026-09-07T11:00:00.000Z" });
  const state = snapshot({
    concepts: [conceptRecord],
    memories: [{ id: id("802"), text: learningOverrideText("skip-concept", conceptRecord.id, "not on the test"), category: "planning", classId, origin: "explicit", revision: 0, createdAt: "2026-09-07T11:30:00.000Z", updatedAt: "2026-09-07T11:30:00.000Z" }],
  });
  const action = deriveLearningLoop(state, now).nextBestAction;
  assert.notEqual(action.conceptIds[0], conceptRecord.id);
  assert.doesNotMatch(action.title, /Excluded chapter/i);
});
