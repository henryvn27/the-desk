import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Assessment,
  Concept,
  Attempt,
  Mistake,
  Task,
  Source,
  StudySession,
  Teacher,
  TeacherEvidence,
  Track,
  Unit,
} from "../domain/contracts";
import { sessionKit } from "./kit";
const task: Task = {
  id: "task",
  classId: "physics",
  title: "Vectors",
  minutes: 30,
  dueAt: null,
  deadlineConfirmed: true,
  notes: "",
  resource: null,
  completed: false,
  createdAt: "2026-09-05T12:00:00Z",
};
test("session kit keeps explicit task sources separate from general class notes", () => {
  const sources: Source[] = [
    { id: "linked", taskIds: [task.id], classIds: [task.classId] },
    { id: "class", taskIds: [], classIds: [task.classId] },
    { id: "other-task", taskIds: ["other"], classIds: [task.classId] },
    { id: "other-class", taskIds: [], classIds: ["other"] },
  ].map((source) => ({
    ...source,
    title: source.id,
    text: "Saved text",
    createdAt: task.createdAt,
    authority: "user-provided-text",
  }));
  const kit = sessionKit(task, { sources, sessions: [] });
  assert.deepEqual(
    kit.linkedSources.map((s) => s.id),
    ["linked"],
  );
  assert.deepEqual(
    kit.classSources.map((s) => s.id),
    ["class"],
  );
  assert.deepEqual(kit.previousReviews, []);
  assert.deepEqual(kit.mistakes, []);
});
test("session kit selects the latest three nonblank ended reviews for this task", () => {
  const sessions: StudySession[] = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    taskId: i === 6 ? "other" : task.id,
    startedAt: task.createdAt,
    endedAt: i === 5 ? null : task.createdAt,
    actualMinutes: 20,
    pausedAt: null,
    pausedMs: 0,
    review: {
      reviewedAt: task.createdAt,
      notes: i === 4 ? "  " : `Review ${i}`,
      remainingMinutes: null,
    },
  }));
  assert.deepEqual(
    sessionKit(task, { sources: [], sessions }).previousReviews.map(
      (s) => s.id,
    ),
    ["3", "2", "1"],
  );
  assert.equal(sessions.length, 7);
});

test("session kit includes same-class mistakes and excludes other classes", () => {
  const mistakes: Mistake[] = [
    {
      id: "physics-mistake",
      classId: task.classId,
      taskId: task.id,
      concept: "Friction",
      source: "Worksheet 4 #7",
      originalAttempt: "Added forces directly",
      whatWentWrong: "Components were mixed",
      correction: "Resolve components first",
      helpUsed: "Teacher feedback",
      confidence: "medium",
      reviewDue: null,
      practiceTaskIds: [],
      revision: 0,
      createdAt: "2026-09-05T12:00:00Z",
      updatedAt: "2026-09-05T12:00:00Z",
    },
    {
      id: "history-mistake",
      classId: "history",
      taskId: null,
      concept: "Causation",
      source: "Essay",
      originalAttempt: "Listed events",
      whatWentWrong: "No causal link",
      correction: "Explain the link",
      helpUsed: "None",
      confidence: "low",
      reviewDue: null,
      practiceTaskIds: [],
      revision: 0,
      createdAt: "2026-09-05T12:00:00Z",
      updatedAt: "2026-09-05T12:00:00Z",
    },
  ];
  assert.deepEqual(
    sessionKit(task, { sources: [], sessions: [], mistakes }).mistakes.map(
      (mistake) => mistake.id,
    ),
    ["physics-mistake"],
  );
});

test("session kit includes linked or weak same-class concepts and excludes unrelated concepts", () => {
  const concepts: Concept[] = [
    {
      id: "linked-concept",
      classId: task.classId,
      taskIds: [task.id],
      name: "Vectors",
      status: "strong",
      preparedness: "ready",
      retentionMode: "course",
      reviewDue: null,
      attempts: 2,
      unaidedCorrect: 2,
      unaidedTotal: 2,
      hintCount: 0,
      lastReviewedAt: null,
      evidenceNote: "Solid setup.",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "weak-concept",
      classId: task.classId,
      taskIds: [],
      name: "Components",
      status: "learning",
      preparedness: "developing",
      retentionMode: "long-term",
      reviewDue: null,
      attempts: 1,
      unaidedCorrect: 0,
      unaidedTotal: 1,
      hintCount: 1,
      lastReviewedAt: null,
      evidenceNote: "Needs another example.",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "other-concept",
      classId: "history",
      taskIds: [],
      name: "Causation",
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
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  assert.deepEqual(
    sessionKit(task, { sources: [], sessions: [], concepts }).concepts.map(
      (concept) => concept.id,
    ),
    ["linked-concept", "weak-concept"],
  );
});

test("session kit includes recent attempts linked to the assignment", () => {
  const attempts: Attempt[] = [
    {
      id: "linked-attempt",
      classId: task.classId,
      taskId: task.id,
      conceptIds: [],
      result: "partial",
      unaided: false,
      hintCount: 2,
      notes: "Needed a sign hint.",
      attemptedAt: "2026-09-05T13:00:00Z",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "other-task-attempt",
      classId: task.classId,
      taskId: "other",
      conceptIds: [],
      result: "correct",
      unaided: true,
      hintCount: 0,
      notes: "",
      attemptedAt: "2026-09-05T14:00:00Z",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  assert.deepEqual(
    sessionKit(task, { sources: [], sessions: [], attempts }).attempts.map(
      (attempt) => attempt.id,
    ),
    ["linked-attempt"],
  );
});

test("session kit includes linked assessment context and excludes other tasks", () => {
  const assessments: Assessment[] = [
    {
      id: "linked-assessment",
      classId: task.classId,
      title: "Kinematics test",
      kind: "test",
      taskIds: [task.id],
      dueAt: "2026-09-08T13:00:00Z",
      gradeCategoryId: null,
      notes: "Bring the formula sheet.",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "other-assessment",
      classId: task.classId,
      title: "Other test",
      kind: "quiz",
      taskIds: ["other"],
      dueAt: null,
      gradeCategoryId: null,
      notes: "",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  assert.deepEqual(
    sessionKit(task, {
      sources: [],
      sessions: [],
      assessments,
    }).assessments.map((assessment) => assessment.id),
    ["linked-assessment"],
  );
});

test("session kit keeps linked teacher evidence separate from Desk context", () => {
  const teacherEvidence: TeacherEvidence[] = [
    {
      id: "linked-evidence",
      classId: task.classId,
      assessmentId: "linked-assessment",
      taskId: null,
      title: "Marked test",
      kind: "graded-work",
      source: "manual",
      scoreEarned: 8,
      scorePossible: 10,
      teacherComments: "Show the sign convention.",
      rubric: "Method and units",
      observations: "Lost points on units.",
      conceptIds: [],
      includeInTeacherModeling: true,
      capturedAt: "2026-09-05T15:00:00Z",
      authority: "teacher-reported",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "other-evidence",
      classId: task.classId,
      assessmentId: "other-assessment",
      taskId: null,
      title: "Other marked work",
      kind: "teacher-feedback",
      source: "manual",
      scoreEarned: null,
      scorePossible: null,
      teacherComments: "",
      rubric: "",
      observations: "",
      conceptIds: [],
      includeInTeacherModeling: true,
      capturedAt: "2026-09-05T16:00:00Z",
      authority: "teacher-reported",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  const assessments: Assessment[] = [
    {
      id: "linked-assessment",
      classId: task.classId,
      title: "Kinematics test",
      kind: "test",
      taskIds: [task.id],
      dueAt: null,
      gradeCategoryId: null,
      notes: "",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  assert.deepEqual(
    sessionKit(task, {
      sources: [],
      sessions: [],
      assessments,
      teacherEvidence,
    }).teacherEvidence.map((evidence) => evidence.id),
    ["linked-evidence"],
  );
});

test("session kit includes explicit same-class teachers and excludes other classes", () => {
  const teachers: Teacher[] = [
    {
      id: "physics-teacher",
      name: "Dr. Rivera",
      email: "rivera@example.edu",
      notes: "Physics instructor",
      classIds: [task.classId],
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "history-teacher",
      name: "Ms. Lee",
      email: null,
      notes: "History instructor",
      classIds: ["history"],
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  assert.deepEqual(
    sessionKit(task, { sources: [], sessions: [], teachers }).teachers.map(
      (teacher) => teacher.id,
    ),
    ["physics-teacher"],
  );
});

test("session kit includes the explicit unit hierarchy for a linked task", () => {
  const tracks: Track[] = [
    {
      id: "mechanics-track",
      classId: task.classId,
      name: "Mechanics",
      notes: "",
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "history-track",
      classId: "history",
      name: "World history",
      notes: "",
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  const units: Unit[] = [
    {
      id: "linked-unit",
      classId: task.classId,
      trackId: "mechanics-track",
      name: "Kinematics",
      kind: "unit",
      sequence: 2,
      notes: "Vectors and motion",
      taskIds: [task.id],
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "unlinked-unit",
      classId: task.classId,
      trackId: null,
      name: "Unlinked",
      kind: "module",
      sequence: 1,
      notes: "",
      taskIds: [],
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
    {
      id: "other-unit",
      classId: "history",
      trackId: "history-track",
      name: "Revolutions",
      kind: "unit",
      sequence: 1,
      notes: "",
      taskIds: [task.id],
      authority: "user-entered",
      revision: 0,
      createdAt: task.createdAt,
      updatedAt: task.createdAt,
    },
  ];
  const kit = sessionKit(task, {
    sources: [],
    sessions: [],
    tracks,
    units,
  });
  assert.deepEqual(
    kit.units.map((unit) => unit.id),
    ["linked-unit"],
  );
  assert.deepEqual(
    kit.tracks.map((track) => track.id),
    ["mechanics-track"],
  );
});
