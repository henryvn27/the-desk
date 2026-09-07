import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot, Task } from "./contracts";
import { deriveClassExperience } from "./class-experience";

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;
const classId = id("100");
const now = new Date("2026-09-07T09:00:00.000Z");

const planning = {
  studyStart: "08:00",
  sleepCutoff: "22:00",
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  bufferPercent: 15,
};

function task(key: string, title: string, dueAt: string | null, options: Partial<Task> = {}): Task {
  return {
    id: id(key),
    title,
    classId,
    dueAt,
    minutes: 45,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: false,
    createdAt: "2026-09-01T08:00:00.000Z",
    revision: 0,
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
    classes: [{ id: classId, name: "AP Physics C", color: "#557562" }],
    tasks: [],
    sessions: [],
    planning,
    ...extra,
  };
}

test("class projection keeps Planner next work and stages canonical units", () => {
  const completed = task("1", "Kinematics set", "2026-09-05T22:00:00.000Z", { completed: true });
  const current = task("2", "Friction problems", "2026-09-08T22:00:00.000Z");
  const upcoming = task("3", "Energy reading", "2026-09-15T22:00:00.000Z");
  const result = deriveClassExperience(snapshot({
    tasks: [completed, current, upcoming],
    units: [
      { id: id("10"), classId, trackId: null, name: "Kinematics", kind: "unit", sequence: 1, notes: "", taskIds: [completed.id], revision: 0, authority: "user-entered", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: id("11"), classId, trackId: null, name: "Forces", kind: "unit", sequence: 2, notes: "", taskIds: [current.id], revision: 0, authority: "user-entered", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: id("12"), classId, trackId: null, name: "Energy", kind: "unit", sequence: 3, notes: "", taskIds: [upcoming.id], revision: 0, authority: "user-entered", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
    ],
  }), classId, now);
  assert.ok(result);
  assert.equal(result.next?.taskId, current.id);
  assert.equal(result.units.past[0]?.name, "Kinematics");
  assert.equal(result.units.current[0]?.name, "Forces");
  assert.equal(result.units.upcoming[0]?.name, "Energy");
});

test("assessment projection connects units, concepts, sources, mistakes, teacher evidence and preparation", () => {
  const preparation = task("20", "Review friction", "2026-09-09T22:00:00.000Z");
  const concept = {
    id: id("30"),
    classId,
    taskIds: [preparation.id],
    name: "Friction",
    status: "developing" as const,
    preparedness: "developing" as const,
    retentionMode: "course" as const,
    reviewDue: null,
    attempts: 0,
    unaidedCorrect: 0,
    unaidedTotal: 0,
    hintCount: 0,
    lastReviewedAt: null,
    evidenceNote: "",
    prerequisiteConceptIds: [],
    revision: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const assessment = {
    id: id("40"),
    classId,
    title: "Unit 2 Test",
    kind: "test" as const,
    taskIds: [preparation.id],
    dueAt: "2026-09-10T22:00:00.000Z",
    gradeCategoryId: null,
    notes: "",
    revision: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const result = deriveClassExperience(snapshot({
    tasks: [preparation],
    concepts: [concept],
    assessments: [assessment],
    units: [{ id: id("41"), classId, trackId: null, name: "Forces", kind: "unit", sequence: 2, notes: "", taskIds: [preparation.id], revision: 0, authority: "user-entered", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
    sources: [{ id: id("42"), title: "Teacher slides", text: "friction", classIds: [classId], taskIds: [preparation.id], format: "slides", kind: "class-material", sourceUrl: null, createdAt: "2026-09-01T00:00:00.000Z", authority: "user-provided-text", annotations: [] }],
    mistakes: [{ id: id("43"), classId, taskId: preparation.id, concept: "Friction", source: "Quiz", originalAttempt: "", whatWentWrong: "", correction: "", helpUsed: "", confidence: "medium", reviewDue: null, practiceTaskIds: [], revision: 0, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }],
    teacherEvidence: [{ id: id("44"), classId, teacherId: null, assessmentId: assessment.id, taskId: preparation.id, title: "Test feedback", kind: "teacher-feedback", source: "manual", scoreEarned: null, scorePossible: null, teacherComments: "Use a free-body diagram.", rubric: "", observations: "", conceptIds: [concept.id], includeInTeacherModeling: true, capturedAt: "2026-09-06T12:00:00.000Z", revision: 0, authority: "teacher-reported", createdAt: "2026-09-06T12:00:00.000Z", updatedAt: "2026-09-06T12:00:00.000Z" }],
  }), classId, now);
  assert.ok(result);
  const view = result.assessments[0]!;
  assert.deepEqual(view.unitNames, ["Forces"]);
  assert.deepEqual(view.conceptNames, ["Friction"]);
  assert.deepEqual(view.sourceTitles, ["Teacher slides"]);
  assert.equal(view.mistakeCount, 1);
  assert.equal(view.teacherEvidenceCount, 1);
});

test("sparse classes stay honest and surface unresolved authority or capture review", () => {
  const uncertain = task("50", "Lab report", "2026-09-12T22:00:00.000Z", {
    deadlineConfirmed: false,
    captureEvidence: {
      originalText: "Lab report due sometime Friday",
      sourceText: "Lab report due sometime Friday",
      capturedAt: "2026-09-06T00:00:00.000Z",
      authority: "user-provided-text",
      candidateDates: [],
      uncertainties: ["The due time is missing."],
      confidence: { dueAt: "low" },
    },
  });
  const claim = {
    id: id("51"),
    classId,
    taskId: uncertain.id,
    fact: "due-date" as const,
    value: "2026-09-12T22:00:00.000Z",
    authorityKind: "syllabus" as const,
    confidence: "medium" as const,
    sourceLabel: "Syllabus",
    details: "Friday",
    sourceId: null,
    evidenceId: null,
    capturedAt: "2026-09-06T00:00:00.000Z",
    revision: 0,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
  const result = deriveClassExperience(snapshot({ tasks: [uncertain], authorityClaims: [claim] }), classId, now);
  assert.ok(result);
  assert.equal(result.units.past.length, 0);
  assert.equal(result.units.current.length, 0);
  assert.ok(result.attention.some((item) => item.kind === "capture-review"));
  assert.ok(result.attention.some((item) => item.kind === "authority-conflict"));
  assert.equal(result.learning.length, 0);
  assert.equal(result.teachers.length, 0);
});
