import { z } from "zod";
import type {
  Concept,
  Mistake,
  Snapshot,
  Task,
} from "../domain/contracts";
import { createStudentModel, type ConceptState } from "../intelligence/student-model";

/**
 * A StudyActivity is a small, persisted learning move inside an existing
 * StudySession. It is intentionally a value object, not a second session or
 * tutor backend. Lens, Notes and the session surface all consume this shape.
 */
export const studyActivityKind = z.enum([
  "learn",
  "check",
  "hint",
  "practice",
  "quiz",
  "exam",
  "explain",
  "recall",
  "correct-mistake",
]);
export type StudyActivityKind = z.infer<typeof studyActivityKind>;

export const studyMode = z.enum(["standard", "quiz", "exam"]);
export type StudyMode = z.infer<typeof studyMode>;

export const studyActivityStatus = z.enum([
  "queued",
  "active",
  "completed",
  "skipped",
]);
export type StudyActivityStatus = z.infer<typeof studyActivityStatus>;

export const studyResponseMode = z.enum([
  "free-response",
  "notes",
  "pencil",
  "multiple-choice",
  "graph",
  "diagram",
]);
export type StudyResponseMode = z.infer<typeof studyResponseMode>;

export const studyFeedbackMode = z.enum([
  "scaffolded",
  "immediate",
  "deferred",
  "none",
]);
export type StudyFeedbackMode = z.infer<typeof studyFeedbackMode>;

export const studyActivitySchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    kind: studyActivityKind,
    status: studyActivityStatus,
    taskId: z.string().trim().min(1).max(160),
    conceptIds: z.array(z.string().trim().min(1).max(160)).max(20),
    sourceIds: z.array(z.string().trim().min(1).max(160)).max(20),
    mistakeIds: z.array(z.string().trim().min(1).max(160)).max(20),
    rationale: z.string().trim().min(1).max(600),
    prompt: z.string().trim().min(1).max(2_000),
    responseMode: studyResponseMode,
    feedback: studyFeedbackMode,
    hintsAllowed: z.boolean(),
    intendedDifficulty: z.enum(["core", "transfer", "challenge"]),
    hintCount: z.number().int().min(0).max(100),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type StudyActivity = z.infer<typeof studyActivitySchema>;

export const studySessionSummarySchema = z
  .object({
    version: z.literal(1),
    inferredAt: z.iso.datetime(),
    activityCount: z.number().int().min(0),
    completedActivityCount: z.number().int().min(0),
    skippedActivityCount: z.number().int().min(0),
    checkedAttemptCount: z.number().int().min(0),
    unaidedAttemptCount: z.number().int().min(0),
    hintCount: z.number().int().min(0),
    evidenceQuality: z.enum(["none", "light", "useful"]),
    nextAction: z.enum([
      "record-a-checked-attempt",
      "review-a-mistake",
      "retrieve-again-later",
      "try-a-transfer-problem",
      "continue-without-change",
    ]),
    caveats: z.array(z.string().trim().min(1).max(300)).max(8),
  })
  .strict();
export type StudySessionSummary = z.infer<typeof studySessionSummarySchema>;

export const studyActivityStateSchema = z
  .object({
    mode: studyMode,
    activities: z.array(studyActivitySchema).max(100),
    currentId: z.string().trim().min(1).max(160).nullable(),
    revision: z.number().int().nonnegative(),
    startedAt: z.iso.datetime(),
    submittedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type StudyActivityState = z.infer<typeof studyActivityStateSchema>;

export type StudyActivityPlanningState = Pick<
  Snapshot,
  | "concepts"
  | "attempts"
  | "mistakes"
  | "sessions"
  | "assessments"
  | "teacherEvidence"
  | "tasks"
  | "sources"
>;

const stateWeight: Record<Concept["preparedness"], number> = {
  "not-ready": 5,
  developing: 4,
  "mostly-ready": 2,
  ready: 1,
  strong: 0,
};

function conceptMistakes(concept: Concept, mistakes: readonly Mistake[]) {
  const key = concept.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return mistakes.filter((mistake) => {
    const candidate = mistake.concept.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return mistake.classId === concept.classId && candidate === key;
  });
}

function scoreConcept(concept: Concept, state: StudyActivityPlanningState, now: Date) {
  const model = createStudentModel({
    concepts: state.concepts,
    attempts: state.attempts,
    mistakes: state.mistakes,
    sessions: state.sessions,
    assessments: state.assessments,
    teacherEvidence: state.teacherEvidence,
    tasks: state.tasks,
  }, now);
  const derived = model.getConceptState(concept.id);
  if (!derived) return { score: 0, derived: undefined as ConceptState | undefined, mistakes: [] as Mistake[] };
    const due = model.getReviewDue(concept.id).status === "due";
  const linked = concept.taskIds.length > 0;
  const mistakes = conceptMistakes(concept, state.mistakes);
  const score =
    stateWeight[derived.preparedness] * 10 +
    (due ? 18 : 0) +
    (derived.prerequisiteGaps.length ? 24 : 0) +
    (derived.retrievability.label === "low" ? 12 : 0) +
    (derived.transferDepth.label === "low" ? 10 : 0) +
    Math.min(18, mistakes.length * 6) +
    (linked ? 3 : 0);
  return { score, derived, mistakes };
}

function difficultyFor(state: ConceptState | undefined): StudyActivity["intendedDifficulty"] {
  if (!state || state.transferDepth.label === "low") return "core";
  if (state.transferDepth.label === "medium") return "transfer";
  return "challenge";
}

function responseModeFor(kind: StudyActivityKind): StudyResponseMode {
  if (kind === "correct-mistake" || kind === "explain" || kind === "learn") return "notes";
  if (kind === "recall") return "free-response";
  if (kind === "quiz" || kind === "exam") return "free-response";
  if (kind === "practice") return "free-response";
  return "free-response";
}

function activityPrompt(kind: StudyActivityKind, conceptName: string, mode: StudyMode) {
  const subject = conceptName || "this task";
  if (mode === "exam" || kind === "exam")
    return `Complete a fixed exam item about ${subject}. Show your reasoning and submit before feedback.`;
  switch (kind) {
    case "learn":
      return `Write a short explanation of ${subject}, then make one prediction about how it changes in a new example.`;
    case "recall":
      return `Without looking at notes, retrieve the definition, governing relationship, or first setup for ${subject}.`;
    case "check":
      return `Attempt a representative ${subject} problem. Show the setup, units, and the step you are least certain about.`;
    case "hint":
      return `Ask for the smallest next step on ${subject} after you show your current attempt.`;
    case "practice":
      return `Solve a new ${subject} problem that changes the surface details. Explain why the same idea still applies.`;
    case "quiz":
      return `Answer a quiz item about ${subject} before requesting feedback. Include enough work to diagnose the method.`;
    case "explain":
      return `Explain the complete method for ${subject}, then separate the general method from this specific example.`;
    case "correct-mistake":
      return `Diagnose and correct the recorded ${subject} mistake. State what you would do differently next time.`;
  }
}

function makeActivity(
  task: Task,
  index: number,
  kind: StudyActivityKind,
  conceptIds: string[],
  conceptName: string,
  rationale: string,
  sourceIds: string[],
  mistakeIds: string[],
  mode: StudyMode,
  now: string,
  state?: ConceptState,
): StudyActivity {
  const assessment = mode === "exam" ? "exam" : mode === "quiz" ? "quiz" : kind;
  const isExam = assessment === "exam";
  return {
    id: `${task.id}:activity:${index + 1}`,
    kind: assessment,
    status: index === 0 ? "active" : "queued",
    taskId: task.id,
    conceptIds: [...new Set(conceptIds)],
    sourceIds: [...new Set(sourceIds)].slice(0, 8),
    mistakeIds: [...new Set(mistakeIds)].slice(0, 8),
    rationale,
    prompt: activityPrompt(assessment, conceptName, mode),
    responseMode: responseModeFor(assessment),
    feedback: isExam ? "none" : mode === "quiz" ? "immediate" : "scaffolded",
    hintsAllowed: !isExam,
    intendedDifficulty: mode === "exam" ? "challenge" : difficultyFor(state),
    hintCount: 0,
    createdAt: now,
    startedAt: index === 0 ? now : null,
    completedAt: null,
  };
}

/** Selects a small, explainable plan from the canonical Student Model. */
export function planStudyActivities(
  task: Task,
  state: StudyActivityPlanningState,
  mode: StudyMode = "standard",
  now = new Date(),
): StudyActivityState {
  const timestamp = now.toISOString();
  const model = createStudentModel({
    concepts: state.concepts,
    attempts: state.attempts,
    mistakes: state.mistakes,
    sessions: state.sessions,
    assessments: state.assessments,
    teacherEvidence: state.teacherEvidence,
    tasks: state.tasks,
  }, now);
  const candidates = state.concepts
    .filter((concept) => concept.classId === task.classId)
    .map((concept) => ({ concept, ...scoreConcept(concept, state, now) }))
    .sort((a, b) => b.score - a.score || a.concept.name.localeCompare(b.concept.name));
  const linkedSources = state.sources
    .filter((source) => source.taskIds.includes(task.id) || (source.taskIds.length === 0 && source.classIds.includes(task.classId)))
    .map((source) => source.id)
    .slice(0, 8);
  const target = candidates[0];
  const targetConcept = target?.concept;
  const targetState = target?.derived;
  const objective = model.recommendLearningObjective({ taskId: task.id });
  const objectiveConcept = objective ? state.concepts.find((concept) => concept.id === objective.conceptId) : undefined;
  const concept = targetConcept ?? objectiveConcept;
  const conceptName = concept?.name ?? "the assignment";
  const conceptIds = concept ? [concept.id] : [];
  const activities: StudyActivity[] = [];
  const add = (kind: StudyActivityKind, ids = conceptIds, reason = "") => {
    if (activities.length >= (mode === "exam" ? 8 : mode === "quiz" ? 6 : 6)) return;
    const current = ids[0] ? state.concepts.find((item) => item.id === ids[0]) : undefined;
    const derived = current ? model.getConceptState(current.id) ?? undefined : undefined;
    const mistakes = current ? conceptMistakes(current, state.mistakes) : [];
    activities.push(makeActivity(task, activities.length, kind, ids, current?.name ?? conceptName, reason, linkedSources, mistakes.map((item) => item.id), mode, timestamp, derived));
  };

  if (mode === "exam") {
    const examConcepts = candidates.slice(0, 6);
    if (!examConcepts.length) add("exam", [], "A fixed exam item is ready for this task.");
    else for (const item of examConcepts) add("exam", [item.concept.id], `Fixed assessment item for ${item.concept.name}.`);
  } else if (mode === "quiz") {
    const quizConcepts = candidates.length ? candidates.slice(0, 6) : [{ concept: undefined, derived: undefined }];
    for (const item of quizConcepts) add("quiz", item.concept ? [item.concept.id] : [], item.concept ? `Adaptive quiz item weighted toward ${item.concept.name}.` : "Adaptive quiz item for this task.");
  } else {
    const gap = targetState?.prerequisiteGaps[0];
    const assessmentRelevant = state.assessments.some((assessment) => assessment.classId === task.classId && assessment.taskIds.includes(task.id));
    if (gap) add("recall", [gap.conceptId], `Prerequisite check first: ${gap.reason}`);
    if (targetState?.retrievability.label === "low" || model.getReviewDue(concept?.id ?? "").status === "due") add("recall", conceptIds, "Retrievability is low or review is due; retrieve before rereading.");
    if (target?.mistakes.length) add("correct-mistake", conceptIds, "A recorded mistake needs a targeted correction before a new attempt.");
    if (targetState?.transferDepth.label === "low") add("practice", conceptIds, "A novel variation will test transfer beyond the original task.");
    if (assessmentRelevant) add("quiz", conceptIds, "This task is linked to an assessment, so the plan includes a feedback-aware check.");
    if (!activities.length || targetState?.preparedness === "not-ready") add("learn", conceptIds, "Build the smallest concept model needed for the task.");
    add("check", conceptIds, "Finish with a checked attempt so the Student Model has usable evidence.");
  }
  if (!activities.length) add(mode === "exam" ? "exam" : mode === "quiz" ? "quiz" : "check", [], "A study activity is ready for this task.");
  return {
    mode,
    activities,
    currentId: activities[0]?.id ?? null,
    revision: 0,
    startedAt: timestamp,
    submittedAt: null,
  };
}

export function activityInstruction(kind: StudyActivityKind, tutoringMode: "guide" | "balanced" | "direct" = "balanced") {
  const base = {
    learn: "Build a compact concept model, then ask the student for a prediction or explanation. Keep the student's work separate from any support.",
    recall: "Prompt retrieval before supplying support. Accept a short attempt and use it to choose the next move.",
    check: "Require a student attempt before evaluating. Identify the earliest meaningful issue and do not reveal a final answer unprompted.",
    hint: "Give exactly the smallest useful next step. Do not include the final answer, the remaining derivation, or a later hint.",
    practice: "Use a novel surface variation and require the student to attempt it before feedback. Do not solve it first.",
    quiz: "Collect the student's answer before feedback. Feedback may be immediate and diagnostic, but preserve the opportunity to retrieve.",
    exam: "Use the fixed blueprint. Do not provide hints, intermediate feedback, or answer-shaped wording before submission.",
    explain: "Explain the complete method when requested. Separate the general method, the worked example, and a check of the student's understanding.",
    "correct-mistake": "Ask the student to diagnose and correct the recorded mistake first. Preserve the original work and explain the correction without rewriting history.",
  } satisfies Record<StudyActivityKind, string>;
  const mode = tutoringMode === "guide"
    ? "Start from the student's attempt and use the smallest scaffold that moves it forward."
    : tutoringMode === "direct"
      ? "A direct explanation is allowed when requested, while still labeling what is student work versus explanation."
      : "Use a focused scaffold and invite a next step when useful.";
  return `${base[kind]} ${mode}`;
}

export function activityLabel(kind: StudyActivityKind) {
  return {
    learn: "Learn",
    check: "Check",
    hint: "Hint",
    practice: "Practice",
    quiz: "Quiz",
    exam: "Exam",
    explain: "Explain",
    recall: "Recall",
    "correct-mistake": "Correct mistake",
  }[kind];
}
