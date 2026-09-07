import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Attempt, Concept, Mistake, StudySession } from "../domain/contracts";
import { DeskStore } from "../domain/store";
import {
  createStudentModel,
  getAssessmentReadiness,
  getConceptState,
  getLikelyMistakePatterns,
  getPrerequisiteGaps,
  getReviewDue,
} from "./student-model";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const iso = (day: number) => `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`;

function concept(
  id: string,
  name = id,
  prerequisiteConceptIds: string[] = [],
): Concept {
  return {
    id,
    classId: "physics",
    taskIds: [],
    prerequisiteConceptIds,
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
    createdAt: iso(1),
    updatedAt: iso(1),
  };
}

function attempt(
  id: string,
  conceptId: string,
  day: number,
  result: Attempt["result"],
  options: Partial<Pick<Attempt, "taskId" | "unaided" | "hintCount" | "notes">> = {},
): Attempt {
  return {
    id,
    classId: "physics",
    taskId: options.taskId ?? `task-${id}`,
    conceptIds: [conceptId],
    result,
    unaided: options.unaided ?? true,
    hintCount: options.hintCount ?? 0,
    notes: options.notes ?? "",
    attemptedAt: iso(day),
    revision: 0,
    createdAt: iso(day),
    updatedAt: iso(day),
  };
}

function state(
  concepts: Concept[],
  attempts: Attempt[] = [],
  mistakes: Mistake[] = [],
  sessions: StudySession[] = [],
) {
  return { concepts, attempts, mistakes, sessions };
}

test("knows but forgets separates competence from retrievability", () => {
  const c = concept("friction");
  const attempts = [1, 2, 3].map((day) => attempt(`a-${day}`, c.id, day, "correct"));
  const derived = getConceptState(state([c], attempts), c.id, NOW)!;
  assert.equal(derived.competence.label, "high");
  assert.equal(derived.retrievability.label, "low");
  assert.match(derived.why.join(" "), /retrievability|review/i);
  assert.equal(getReviewDue(state([c], attempts), c.id, NOW).status, "due");
});

test("a correct guess is not treated as broad mastery", () => {
  const c = concept("vectors");
  const derived = getConceptState(
    state([c], [attempt("guess", c.id, 29, "correct", { notes: "Lucky guess" })]),
    c.id,
    NOW,
  )!;
  assert.equal(derived.preparedness, "developing");
  assert.match(derived.why.join(" "), /guess/i);
  assert.equal(derived.transferDepth.label, "low");
});

test("repeated mistakes become a pattern while a single mistake stays provisional", () => {
  const c = concept("signs", "Sign conventions");
  const makeMistake = (id: string, day: number): Mistake => ({
    id,
    classId: "physics",
    taskId: `task-${id}`,
    concept: c.name,
    source: `Worksheet ${day}`,
    originalAttempt: "Used a negative value",
    whatWentWrong: "Sign error in the component",
    correction: "Check the direction before substituting.",
    helpUsed: "Hint",
    confidence: "medium",
    reviewDue: null,
    practiceTaskIds: [],
    revision: 0,
    createdAt: iso(day),
    updatedAt: iso(day),
  });
  const one = getLikelyMistakePatterns(state([c], [], [makeMistake("m1", 28)]), c.id, NOW);
  assert.equal(one[0]!.persistence, "single-incident");
  const repeated = getLikelyMistakePatterns(
    state([c], [], [makeMistake("m1", 28), makeMistake("m2", 29)]),
    c.id,
    NOW,
  );
  assert.equal(repeated[0]!.key, "sign-error");
  assert.equal(repeated[0]!.persistence, "repeated");
});

test("slow improvement uses recent evidence without erasing earlier failures", () => {
  const c = concept("algebra");
  const derived = getConceptState(
    state([c], [
      attempt("old", c.id, 20, "incorrect"),
      attempt("middle", c.id, 27, "partial"),
      attempt("new", c.id, 29, "correct"),
    ]),
    c.id,
    NOW,
  )!;
  assert.ok((derived.competence.value ?? 0) > 0.25);
  assert.equal(derived.evidence.scoredAttempts, 3);
  assert.ok(derived.why.some((item) => /unaided attempt/.test(item)));
});

test("a later correct attempt resolves a one-off careless slip", () => {
  const c = concept("careless");
  const mistake: Mistake = {
    id: "slip",
    classId: "physics",
    taskId: "task-2",
    concept: c.name,
    source: "Worksheet",
    originalAttempt: "Dropped a sign",
    whatWentWrong: "Careless sign error",
    correction: "Rewrite the sign before checking.",
    helpUsed: "None",
    confidence: "low",
    reviewDue: null,
    practiceTaskIds: [],
    revision: 0,
    createdAt: iso(20),
    updatedAt: iso(20),
  };
  const derived = getConceptState(
    state([c], [
      attempt("good-1", c.id, 18, "correct"),
      attempt("bad", c.id, 20, "incorrect"),
      attempt("good-2", c.id, 22, "correct"),
    ], [mistake]),
    c.id,
    NOW,
  )!;
  assert.equal(derived.unresolvedMistakes, 0);
  assert.ok((derived.competence.value ?? 0) > 0.55);
});

test("confidence capture identifies an underconfident strong learner", () => {
  const c = concept("calibrated");
  const attempts = [1, 2, 3, 4].map((day) => attempt(`a-${day}`, c.id, day + 20, "correct"));
  const session: StudySession = {
    id: "s1",
    taskId: attempts[0]!.taskId!,
    startedAt: iso(25),
    pausedAt: null,
    pausedMs: 0,
    endedAt: iso(25),
    actualMinutes: 20,
    evidenceAttemptIds: attempts.map((item) => item.id),
    review: {
      reviewedAt: iso(25),
      notes: "Checked",
      remainingMinutes: null,
      confidence: { rating: 1, conceptIds: [c.id], capturedAt: iso(25) },
    },
  };
  const derived = getConceptState(state([c], attempts, [], [session]), c.id, NOW)!;
  assert.equal(derived.calibration.status, "underconfident");
  assert.ok(derived.preparedness === "strong" || derived.preparedness === "ready");
  assert.equal(
    createStudentModel(state([c], attempts, [], [session]), NOW).recordConfidenceEvidence({
      sessionId: session.id,
      rating: 1,
    }).accepted,
    true,
  );
  assert.equal(
    createStudentModel(state([c], attempts, [], [session]), NOW).recordConfidenceEvidence({
      sessionId: session.id,
      rating: 5,
    }).accepted,
    false,
  );
});

test("confidence capture identifies an overconfident weak learner", () => {
  const c = concept("overconfident");
  const attempts = [1, 2, 3].map((day) => attempt(`a-${day}`, c.id, day + 20, "incorrect"));
  const session: StudySession = {
    id: "s1",
    taskId: attempts[0]!.taskId!,
    startedAt: iso(25),
    pausedAt: null,
    pausedMs: 0,
    endedAt: iso(25),
    actualMinutes: 20,
    evidenceAttemptIds: attempts.map((item) => item.id),
    review: {
      reviewedAt: iso(25),
      notes: "Checked",
      remainingMinutes: null,
      confidence: { rating: 5, conceptIds: [c.id], capturedAt: iso(25) },
    },
  };
  const derived = getConceptState(state([c], attempts, [], [session]), c.id, NOW)!;
  assert.equal(derived.calibration.status, "overconfident");
  assert.equal(derived.preparedness, "developing");
});

test("insufficient evidence stays explicit", () => {
  const c = concept("new");
  const input = state([c]);
  const derived = getConceptState(input, c.id, NOW)!;
  assert.equal(derived.preparedness, "not-ready");
  assert.equal(derived.evidenceConfidence.label, "insufficient");
  assert.equal(getReviewDue(input, c.id, NOW).status, "no-evidence");
});

test("derived preparedness changes stale V1 decisions without rewriting the recorded field", () => {
  const recordedStrong = concept("stale-strong");
  recordedStrong.preparedness = "strong";
  const oldV1Decision = recordedStrong.preparedness;
  const derivedWithoutEvidence = getConceptState(
    state([recordedStrong]),
    recordedStrong.id,
    NOW,
  )!;
  assert.equal(oldV1Decision, "strong");
  assert.equal(derivedWithoutEvidence.recordedPreparedness, "strong");
  assert.equal(derivedWithoutEvidence.preparedness, "not-ready");

  const recordedNotReady = concept("recovered");
  recordedNotReady.preparedness = "not-ready";
  const attempts = [1, 2, 3, 4].map((day) =>
    attempt(`recovered-${day}`, recordedNotReady.id, day + 20, "correct", {
      taskId: `mixed-task-${day}`,
    }),
  );
  const recovered = getConceptState(
    state([recordedNotReady], attempts),
    recordedNotReady.id,
    NOW,
  )!;
  assert.equal(recovered.recordedPreparedness, "not-ready");
  assert.ok(["mostly-ready", "ready", "strong"].includes(recovered.preparedness));
});

test("a weak prerequisite blocks advanced readiness and assessment readiness", () => {
  const prerequisite = concept("vectors", "Vectors");
  const advanced = concept("projectile", "Projectile motion", [prerequisite.id]);
  advanced.taskIds = ["assessment-prep"];
  const attempts = [1, 2, 3].map((day) => attempt(`p-${day}`, advanced.id, day + 20, "correct", { taskId: "assessment-prep" }));
  const assessment = {
    id: "midterm",
    classId: "physics",
    title: "Midterm",
    kind: "midterm" as const,
    taskIds: ["assessment-prep"],
    dueAt: iso(40),
    gradeCategoryId: null,
    notes: "",
    revision: 0,
    createdAt: iso(1),
    updatedAt: iso(1),
  };
  const input = { ...state([prerequisite, advanced], attempts), assessments: [assessment] };
  const gaps = getPrerequisiteGaps(input, advanced.id, NOW);
  assert.equal(gaps[0]!.name, prerequisite.name);
  assert.equal(getConceptState(input, advanced.id, NOW)!.preparedness, "developing");
  assert.equal(getAssessmentReadiness(input, assessment.id, NOW)!.state, "developing");
});

test("a strong prerequisite does not hide a weak advanced application", () => {
  const prerequisite = concept("kinematics", "Kinematics");
  const advanced = concept("projectile-application", "Projectile application", [prerequisite.id]);
  const prerequisiteAttempts = [1, 2, 3].map((day) =>
    attempt(`kinematics-${day}`, prerequisite.id, day + 26, "correct", {
      taskId: `kinematics-task-${day}`,
    }),
  );
  const advancedAttempt = attempt("projectile-incorrect", advanced.id, 29, "incorrect", {
    taskId: "projectile-task",
  });
  const input = state([prerequisite, advanced], [
    ...prerequisiteAttempts,
    advancedAttempt,
  ]);
  const prerequisiteState = getConceptState(input, prerequisite.id, NOW)!;
  const advancedState = getConceptState(input, advanced.id, NOW)!;
  assert.ok(["ready", "strong"].includes(prerequisiteState.preparedness));
  assert.equal(advancedState.prerequisiteGaps.length, 0);
  assert.equal(advancedState.preparedness, "developing");
  assert.match(advancedState.why.join(" "), /not fully correct|transfer/i);
});

test("the model consumes real V1 store attempts and session confidence without a parallel evidence table", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-student-model-store-"));
  const store = new DeskStore(join(directory, "desk.sqlite"));
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" }).classes[0]!.id;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Mixed retrieval",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    const prerequisite = store.execute({
      type: "concept.create",
      input: {
        classId,
        taskIds: [],
        name: "Vectors",
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
    }).concepts.at(-1)!;
    const advanced = store.execute({
      type: "concept.create",
      input: {
        classId,
        taskIds: [task.id],
        name: "Projectile motion",
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
        prerequisiteConceptIds: [prerequisite.id],
      },
    }).concepts.at(-1)!;
    const start = new Date("2026-09-20T12:00:00.000Z");
    const session = store.execute({ type: "session.start", taskId: task.id }, start).sessions.at(-1)!;
    store.execute({ type: "session.end", completed: false }, new Date(+start + 20 * 60000));
    store.execute({
      type: "session.review",
      id: session.id,
      notes: "Checked a new problem.",
      remainingMinutes: null,
      attempts: [
        {
          conceptIds: [advanced.id],
          result: "correct",
          unaided: true,
          hintCount: 0,
          notes: "",
        },
      ],
      confidence: { rating: 5, conceptIds: [advanced.id] },
    }, new Date("2026-09-20T12:30:00.000Z"));
    const snapshot = store.snapshot();
    const derived = getConceptState(snapshot, advanced.id, NOW)!;
    assert.equal(snapshot.sessions[0]!.review?.confidence?.rating, 5);
    assert.equal(snapshot.attempts.length, 1);
    assert.equal(derived.evidence.source, "attempts");
    assert.equal(derived.prerequisiteGaps[0]!.name, prerequisite.name);
    assert.equal(derived.calibration.status, "calibrated");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
