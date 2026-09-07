import type {
  Concept,
  Snapshot,
  Task,
} from "../domain/contracts";
import { createStudentModel, type ConceptState } from "./student-model";
import { deriveHome, type HomeProjection } from "../planner/home";

/**
 * The closed-loop learning projection is deliberately read-only. Tasks,
 * Concepts, Attempts, Mistakes and StudySessions remain the source of truth;
 * this module explains what the next move should be and what evidence would
 * make the next recommendation different.
 */
export type LearningActionKind =
  | "assignment"
  | "practice"
  | "review"
  | "remediation"
  | "test_out"
  | "reading"
  | "notes"
  | "assessment_prep"
  | "external_resource"
  | "break"
  | "done";

export type RecommendationFactor = {
  id: string;
  label: string;
  detail: string;
  weight: number;
};

export type CompletionCriterion = {
  type: "task-progress" | "checked-attempt" | "review" | "capture";
  label: string;
  conceptIds?: string[];
};

export type TestOutPrompt = {
  id: string;
  conceptId: string;
  prompt: string;
  difficulty: "core" | "transfer";
  rationale: string;
  sourceIds: string[];
};

export type TestOutPlan = {
  id: string;
  conceptId: string;
  conceptName: string;
  taskId?: string;
  estimatedMinutes: number;
  reason: string;
  evidenceIds: string[];
  sourceIds: string[];
  prompts: TestOutPrompt[];
};

export type NextBestAction = {
  id: string;
  kind: LearningActionKind;
  title: string;
  classId?: string;
  taskId?: string;
  conceptIds: string[];
  estimatedMinutes: number;
  reason: {
    primary: string;
    factors: RecommendationFactor[];
  };
  urgency: number;
  expectedValue: number;
  confidence: number;
  evidenceIds: string[];
  sourceIds: string[];
  completionCriteria: CompletionCriterion[];
  createdAt: string;
  testOut?: TestOutPlan;
};

export type RemediationCandidate = {
  id: string;
  blockedConceptId: string;
  blockedConceptName: string;
  conceptId: string;
  conceptName: string;
  estimatedMinutes: number;
  score: number;
  reason: string;
  evidenceIds: string[];
  mistakeIds: string[];
};

export type IncompleteLearningLoop = {
  id: string;
  kind: "session-review" | "session-evidence" | "mistake-correction" | "assessment-coverage";
  title: string;
  detail: string;
  taskId?: string;
  conceptId?: string;
};

export type EffectiveLearning = {
  windowDays: number;
  scheduledMinutes: number;
  trackedMinutes: number;
  engagedMinutes: number;
  evidenceMinutes: number;
  checkedAttempts: number;
  strongEvidence: number;
  confidence: "low" | "medium" | "high";
  explanation: string;
};

export type AssessmentLearningReadiness = {
  assessmentId: string;
  title: string;
  dueAt: string | null;
  state: Concept["preparedness"];
  weakestConceptId: string | null;
  weakestConceptName: string | null;
  why: string[];
};

export type PackedTimeBlock = {
  startMinute: number;
  endMinute: number;
  minutes: number;
  kind: LearningActionKind;
  title: string;
  reason: string;
  taskId?: string;
  conceptIds: string[];
};

export type AvailableTimePlan = {
  availableMinutes: number;
  blocks: PackedTimeBlock[];
  unusedMinutes: number;
  explanation: string;
};

export type LearningLoopProjection = {
  nextBestAction: NextBestAction;
  remediations: RemediationCandidate[];
  incompleteLoops: IncompleteLearningLoop[];
  effectiveLearning: EffectiveLearning;
  assessmentReadiness: AssessmentLearningReadiness[];
};

export type LearningOverride = {
  kind: "skip-concept";
  conceptId: string;
  memoryId: string;
  reason: string;
};

type StudentModel = ReturnType<typeof createStudentModel>;

const DAY = 86_400_000;
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function finiteDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date : null;
}

function taskFor(snapshot: Snapshot, id: string | undefined) {
  return id ? snapshot.tasks.find((task) => task.id === id) : undefined;
}

function conceptFor(snapshot: Snapshot, id: string | undefined) {
  return id ? snapshot.concepts.find((concept) => concept.id === id) : undefined;
}

function firstOpenTaskForConcepts(snapshot: Snapshot, conceptIds: string[]) {
  const linked = new Set(conceptIds);
  return snapshot.tasks
    .filter((task) => !task.completed && snapshot.concepts.some((concept) => linked.has(concept.id) && concept.taskIds.includes(task.id)))
    .sort((a, b) => {
      const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      return aDue - bDue || a.id.localeCompare(b.id);
    })[0] ?? null;
}

const overridePrefix = "desk.learning.override:";

/** Persist recommendation corrections through the existing AcademicMemory store. */
export function learningOverrideText(kind: LearningOverride["kind"], targetId: string, reason = "user correction") {
  return `${overridePrefix}${kind}:${targetId}:${reason.slice(0, 300)}`;
}

function learningOverrides(snapshot: Snapshot) {
  return snapshot.memories.flatMap((memory) => {
    if (memory.category !== "planning" || !memory.text.startsWith(overridePrefix)) return [];
    const [, kind, conceptId, ...reason] = memory.text.split(":");
    return kind === "skip-concept" && conceptId
      ? [{ kind, conceptId, memoryId: memory.id, reason: reason.join(":") || "user correction" } satisfies LearningOverride]
      : [];
  });
}

function linkedSourceIds(snapshot: Snapshot, classId: string | undefined, taskId?: string) {
  if (!classId) return [];
  return snapshot.sources
    .filter((source) =>
      source.classIds.includes(classId) &&
      (source.taskIds.length === 0 || (taskId ? source.taskIds.includes(taskId) : false)),
    )
    .map((source) => source.id)
    .slice(0, 8);
}

function evidenceIdsForState(state: ConceptState) {
  return [
    ...state.attemptIds,
    ...state.mistakePatterns.flatMap((pattern) => pattern.mistakeIds),
  ].slice(0, 20);
}

function scoreLabel(value: number) {
  return value >= 0.78 ? "strong" : value >= 0.55 ? "developing" : "limited";
}

/** Build a small representative check without asking a model to invent facts. */
export function buildTestOutPlan(
  snapshot: Snapshot,
  conceptId: string,
  now = new Date(),
  taskId?: string,
  suppliedModel?: StudentModel,
): TestOutPlan | null {
  const concept = conceptFor(snapshot, conceptId);
  if (!concept) return null;
  const model = suppliedModel ?? createStudentModel(snapshot, now);
  const state = model.getConceptState(concept.id);
  if (!state) return null;
  const task = taskFor(snapshot, taskId) ?? snapshot.tasks.find((candidate) => candidate.classId === concept.classId && concept.taskIds.includes(candidate.id));
  const sourceIds = linkedSourceIds(snapshot, concept.classId, task?.id);
  const prompts: TestOutPrompt[] = [
    {
      id: `${concept.id}:recall`,
      conceptId: concept.id,
      prompt: `Without looking at notes, define ${concept.name} and state the first setup step you would use in a representative problem.`,
      difficulty: "core",
      rationale: "A short unaided retrieval check separates recognition from usable recall.",
      sourceIds,
    },
    {
      id: `${concept.id}:apply`,
      conceptId: concept.id,
      prompt: task
        ? `Solve a new ${concept.name} problem related to “${task.title}”. Show the setup, units or assumptions, and your reasoning.`
        : `Solve a new representative problem involving ${concept.name}. Show the setup, units or assumptions, and your reasoning.`,
      difficulty: "transfer",
      rationale: "A changed surface tests whether the idea transfers beyond the original example.",
      sourceIds,
    },
  ];
  const gap = state.prerequisiteGaps[0];
  if (gap || state.transferDepth.label === "low") {
    prompts.push({
      id: `${concept.id}:explain`,
      conceptId: concept.id,
      prompt: gap
        ? `Explain how ${gap.name} supports ${concept.name}, then describe one way a mistake in that prerequisite would change your answer.`
        : `Explain why the method for ${concept.name} still works when the surface details change.`,
      difficulty: "transfer",
      rationale: gap
        ? "The check probes the dependency that currently limits this concept."
        : "The check probes transfer rather than repeated pattern matching.",
      sourceIds,
    });
  }
  return {
    id: `test-out:${concept.id}:${now.toISOString().slice(0, 10)}`,
    conceptId: concept.id,
    conceptName: concept.name,
    ...(task?.id ? { taskId: task.id } : {}),
    estimatedMinutes: prompts.length * 6,
    reason:
      state.preparedness === "strong" || state.preparedness === "ready"
        ? `${concept.name} has enough evidence for a short confirmation instead of an automatic review block.`
        : `Use a representative check before spending more time on ${concept.name}.`,
    evidenceIds: evidenceIdsForState(state),
    sourceIds,
    prompts,
  };
}

function failedAttempts(snapshot: Snapshot, conceptId: string, now: Date) {
  return snapshot.attempts.filter((attempt) => {
    const age = finiteDate(attempt.attemptedAt);
    return (
      attempt.conceptIds.includes(conceptId) &&
      attempt.unaided &&
      (attempt.result === "incorrect" || attempt.result === "partial") &&
      Boolean(age && +now - +age <= 45 * DAY)
    );
  });
}

function deriveRemediationsWithModel(snapshot: Snapshot, now: Date, model: StudentModel): RemediationCandidate[] {
  const skipped = new Set(learningOverrides(snapshot).map((override) => override.conceptId));
  const candidates: RemediationCandidate[] = [];
  for (const concept of snapshot.concepts) {
    if (skipped.has(concept.id)) continue;
    const state = model.getConceptState(concept.id);
    if (!state) continue;
    const failures = failedAttempts(snapshot, concept.id, now);
    const repeated = state.mistakePatterns.filter((pattern) => pattern.persistence === "repeated");
    if (failures.length < 2 || (!state.prerequisiteGaps.length && !repeated.length && state.unresolvedMistakes === 0)) continue;
    const gap = state.prerequisiteGaps[0];
    const target = gap && !skipped.has(gap.conceptId) ? conceptFor(snapshot, gap.conceptId) : concept;
    if (!target) continue;
    const mistakeIds = state.mistakePatterns.flatMap((pattern) => pattern.mistakeIds).slice(0, 8);
    const evidenceIds = [...new Set([...failures.map((attempt) => attempt.id), ...mistakeIds])].slice(0, 20);
    const score = failures.length * 14 + state.unresolvedMistakes * 8 + (gap ? 24 : 0) + repeated.length * 7;
    candidates.push({
      id: `remediation:${concept.id}:${target.id}`,
      blockedConceptId: concept.id,
      blockedConceptName: concept.name,
      conceptId: target.id,
      conceptName: target.name,
      estimatedMinutes: gap ? 12 : 15,
      score,
      reason: gap
        ? `${concept.name} has ${failures.length} recent unaided misses and ${target.name} is the weakest prerequisite.`
        : `${concept.name} has ${failures.length} recent unaided misses with a recurring error pattern; repair the cause before repeating the same work.`,
      evidenceIds,
      mistakeIds,
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.conceptName.localeCompare(b.conceptName)).slice(0, 8);
}

export function deriveRemediations(snapshot: Snapshot, now = new Date()): RemediationCandidate[] {
  return deriveRemediationsWithModel(snapshot, now, createStudentModel(snapshot, now));
}

function actionForTask(snapshot: Snapshot, task: Task, now: Date, home: HomeProjection, model: StudentModel): NextBestAction {
  const skipped = new Set(learningOverrides(snapshot).map((override) => override.conceptId));
  const linkedConcepts = snapshot.concepts.filter((concept) => concept.classId === task.classId && concept.taskIds.includes(task.id) && !skipped.has(concept.id));
  const states = linkedConcepts.map((concept) => model.getConceptState(concept.id)).filter((state): state is ConceptState => Boolean(state));
  const weak = [...states].sort((a, b) => (a.competence.value ?? 0) - (b.competence.value ?? 0))[0];
  const sourceIds = linkedSourceIds(snapshot, task.classId, task.id);
  const due = task.dueAt && task.deadlineConfirmed ? Date.parse(task.dueAt) : Number.POSITIVE_INFINITY;
  const hours = Number.isFinite(due) ? Math.max(0, (due - +now) / 3_600_000) : Infinity;
  const deadlineWeight = hours <= 24 ? 1 : hours <= 72 ? 0.75 : 0.45;
  const factors: RecommendationFactor[] = [
    { id: "planner", label: "Plan", detail: home.next?.taskId === task.id ? "This is the Planner's current executable block." : "This task is the safest required work to advance next.", weight: 0.8 },
  ];
  if (Number.isFinite(due)) factors.push({ id: "deadline", label: "Deadline", detail: `Confirmed deadline ${new Date(due).toLocaleString()}.`, weight: deadlineWeight });
  if (weak) factors.push({ id: "learning", label: "Learning", detail: `${weak.name} is ${weak.preparedness.replace("-", " ")} with ${scoreLabel(weak.evidenceConfidence.value ?? 0)} evidence confidence.`, weight: 0.55 });
  const testOut = weak && (weak.preparedness === "ready" || weak.preparedness === "strong" || (weak.competence.value ?? 0) >= 0.55)
    ? buildTestOutPlan(snapshot, weak.conceptId, now, task.id, model)
    : undefined;
  return {
    id: `next-best:assignment:${task.id}`,
    kind: task.workKind === "assessment" ? "assessment_prep" : "assignment",
    title: task.title,
    ...(task.classId ? { classId: task.classId } : {}),
    taskId: task.id,
    conceptIds: linkedConcepts.map((concept) => concept.id),
    estimatedMinutes: Math.max(5, task.minutes),
    reason: {
      primary: Number.isFinite(due) && hours <= 24 ? "Protect the nearest confirmed deadline before optimizing optional learning." : home.next?.taskId === task.id ? home.next.why : "Required work is the clearest executable next step.",
      factors,
    },
    urgency: Number.isFinite(due) ? clamp(1 - Math.max(0, hours) / (7 * 24)) : 0.35,
    expectedValue: clamp(0.55 + deadlineWeight * 0.3 + (weak ? 0.15 : 0)),
    confidence: task.deadlineConfirmed ? 0.96 : 0.62,
    evidenceIds: [...new Set(linkedConcepts.flatMap((concept) => model.getConceptState(concept.id)?.attemptIds ?? []))].slice(0, 20),
    sourceIds,
    completionCriteria: [
      { type: "task-progress", label: task.checklist?.some((item) => !item.completed && !item.archived) ? "Complete the next unchecked task step." : "Finish the assignment and confirm the remaining work." },
      ...(weak ? [{ type: "checked-attempt" as const, label: `Record one checked attempt for ${weak.name}.`, conceptIds: [weak.conceptId] }] : []),
    ],
    createdAt: now.toISOString(),
    ...(testOut ? { testOut } : {}),
  };
}

function actionForRemediation(snapshot: Snapshot, candidate: RemediationCandidate, now: Date, model: StudentModel): NextBestAction {
  const state = model.getConceptState(candidate.conceptId);
  const sourceIds = linkedSourceIds(snapshot, conceptFor(snapshot, candidate.conceptId)?.classId);
  const testOut = buildTestOutPlan(snapshot, candidate.conceptId, now, undefined, model);
  const task = firstOpenTaskForConcepts(snapshot, [candidate.conceptId, candidate.blockedConceptId]);
  return {
    id: `next-best:remediation:${candidate.id}`,
    kind: "remediation",
    title: `Fix ${candidate.conceptName} before returning to ${candidate.blockedConceptName}`,
    classId: conceptFor(snapshot, candidate.conceptId)?.classId,
    ...(task ? { taskId: task.id } : {}),
    conceptIds: [candidate.conceptId, candidate.blockedConceptId],
    estimatedMinutes: candidate.estimatedMinutes,
    reason: {
      primary: candidate.reason,
      factors: [
        { id: "failures", label: "Repeated misses", detail: candidate.reason, weight: 0.9 },
        { id: "prerequisite", label: "Dependency", detail: `Repair ${candidate.conceptName}, then retry ${candidate.blockedConceptName}.`, weight: 0.85 },
      ],
    },
    urgency: 0.72,
    expectedValue: clamp(0.65 + candidate.score / 140),
    confidence: state?.evidenceConfidence.value ?? 0.64,
    evidenceIds: candidate.evidenceIds,
    sourceIds,
    completionCriteria: [{ type: "checked-attempt", label: `Demonstrate ${candidate.conceptName} in one checked attempt.`, conceptIds: [candidate.conceptId] }],
    createdAt: now.toISOString(),
    ...(testOut ? { testOut } : {}),
  };
}

function actionForConcept(snapshot: Snapshot, state: ConceptState, now: Date, kind: "review" | "practice" | "test_out", model: StudentModel): NextBestAction {
  const concept = conceptFor(snapshot, state.conceptId)!;
  const sourceIds = linkedSourceIds(snapshot, concept.classId);
  const testOut = buildTestOutPlan(snapshot, state.conceptId, now, undefined, model);
  const task = firstOpenTaskForConcepts(snapshot, [state.conceptId]);
  const due = state.memory.reviewDue && finiteDate(state.memory.reviewDue) && +finiteDate(state.memory.reviewDue)! <= +now;
  const title = kind === "test_out" ? `Test out of ${state.name}` : due ? `Retrieve ${state.name} before it fades` : `Practice ${state.name} unaided`;
  return {
    id: `next-best:${kind}:${state.conceptId}`,
    kind,
    title,
    classId: concept.classId,
    ...(task ? { taskId: task.id } : {}),
    conceptIds: [state.conceptId],
    estimatedMinutes: testOut?.estimatedMinutes ?? 12,
    reason: {
      primary: kind === "test_out" ? testOut?.reason ?? `Check whether ${state.name} still needs review.` : state.why[0] ?? `Retrieval evidence for ${state.name} is due.`,
      factors: [
        { id: "mastery", label: "Mastery", detail: `${state.name} is ${state.preparedness.replace("-", " ")}.`, weight: 0.7 },
        ...(due ? [{ id: "retrieval", label: "Retrieval risk", detail: "The next review window has arrived.", weight: 0.85 }] : []),
        ...(state.unresolvedMistakes ? [{ id: "mistakes", label: "Mistake pattern", detail: `${state.unresolvedMistakes} unresolved mistake${state.unresolvedMistakes === 1 ? "" : "s"} still needs a checked correction.`, weight: 0.7 }] : []),
      ],
    },
    urgency: due ? 0.68 : 0.42,
    expectedValue: clamp(0.5 + (state.retrievability.value === null ? 0.2 : 1 - state.retrievability.value) * 0.45),
    confidence: state.evidenceConfidence.value ?? 0.55,
    evidenceIds: evidenceIdsForState(state),
    sourceIds,
    completionCriteria: [{ type: "checked-attempt", label: `Record a checked ${state.name} result.`, conceptIds: [state.conceptId] }],
    createdAt: now.toISOString(),
    ...(testOut ? { testOut } : {}),
  };
}

function nearestDeadline(snapshot: Snapshot, now: Date) {
  return snapshot.tasks
    .filter((task) => !task.completed && task.deadlineConfirmed && task.dueAt)
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.id.localeCompare(b.id))
    .find((task) => Date.parse(task.dueAt!) >= +now - DAY) ?? null;
}

function assessmentReadiness(snapshot: Snapshot, model: ReturnType<typeof createStudentModel>, now: Date): AssessmentLearningReadiness[] {
  return snapshot.assessments
    .map((assessment) => {
      const readiness = model.getAssessmentReadiness(assessment.id);
      const weakest = readiness?.conceptStates.slice().sort((a, b) => (a.competence.value ?? 0) - (b.competence.value ?? 0))[0];
      return {
        assessmentId: assessment.id,
        title: assessment.title,
        dueAt: assessment.dueAt,
        state: readiness?.state ?? "not-ready",
        weakestConceptId: weakest?.conceptId ?? null,
        weakestConceptName: weakest?.name ?? null,
        why: readiness?.why.slice(0, 4) ?? ["No checked concept evidence is linked yet."],
      } satisfies AssessmentLearningReadiness;
    })
    .filter((item) => !item.dueAt || Date.parse(item.dueAt) >= +now - DAY)
    .sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) || a.title.localeCompare(b.title))
    .slice(0, 12);
}

function deriveNextBestAction(snapshot: Snapshot, now: Date, home: HomeProjection, remediations: RemediationCandidate[], readiness: AssessmentLearningReadiness[], model: StudentModel): NextBestAction {
  const skipped = new Set(learningOverrides(snapshot).map((override) => override.conceptId));
  const active = snapshot.sessions.find((session) => !session.endedAt);
  if (active) {
    const task = taskFor(snapshot, active.taskId);
    return {
      id: `next-best:active:${active.id}`,
      kind: "assignment",
      title: task ? `Continue ${task.title}` : "Continue the active study session",
      ...(task?.classId ? { classId: task.classId } : {}),
      taskId: active.taskId,
      conceptIds: [],
      estimatedMinutes: Math.max(5, task?.minutes ?? 25),
      reason: { primary: "An active session already owns the controls; keep the loop moving before choosing another task.", factors: [{ id: "active-session", label: "Active session", detail: "The current session has not been ended.", weight: 1 }] },
      urgency: 1,
      expectedValue: 0.8,
      confidence: 1,
      evidenceIds: active.evidenceAttemptIds ?? [],
      sourceIds: linkedSourceIds(snapshot, task?.classId, task?.id),
      completionCriteria: [{ type: "review", label: "End the session and record what changed." }],
      createdAt: now.toISOString(),
    };
  }
  const deadline = nearestDeadline(snapshot, now);
  if (deadline && deadline.dueAt && Date.parse(deadline.dueAt) - +now <= 48 * 3_600_000) return actionForTask(snapshot, deadline, now, home, model);
  const remediation = remediations[0];
  if (remediation && (!home.next || remediation.score >= 45)) return actionForRemediation(snapshot, remediation, now, model);
  const upcomingReadiness = readiness.find((item) => item.dueAt && Date.parse(item.dueAt) - +now <= 7 * DAY && item.weakestConceptId && !skipped.has(item.weakestConceptId));
  if (upcomingReadiness?.weakestConceptId) {
    const state = model.getConceptState(upcomingReadiness.weakestConceptId);
    const assessment = snapshot.assessments.find((item) => item.id === upcomingReadiness.assessmentId);
    if (state && assessment) {
      const action = actionForConcept(snapshot, state, now, state.preparedness === "ready" || state.preparedness === "strong" ? "test_out" : "review", model);
      return {
        ...action,
        id: `next-best:assessment:${assessment.id}:${state.conceptId}`,
        kind: "assessment_prep",
        title: `${action.title} for ${assessment.title}`,
        reason: {
          primary: `Assessment ${assessment.title} is approaching; ${action.reason.primary}`,
          factors: [{ id: "assessment", label: "Assessment", detail: assessment.dueAt ? `Due ${new Date(assessment.dueAt).toLocaleString()}.` : "This assessment is in the current learning scope.", weight: 0.9 }, ...action.reason.factors],
        },
      };
    }
  }
  const dueConcept = snapshot.concepts
    .map((concept) => model.getConceptState(concept.id))
    .filter((state): state is ConceptState => state !== null && !skipped.has(state.conceptId))
    .filter((state) => state.memory.reviewDue && finiteDate(state.memory.reviewDue) && +finiteDate(state.memory.reviewDue)! <= +now && state.preparedness !== "strong")
    .sort((a, b) => (a.retrievability.value ?? 0) - (b.retrievability.value ?? 0) || a.name.localeCompare(b.name))[0];
  if (dueConcept) return actionForConcept(snapshot, dueConcept, now, dueConcept.preparedness === "ready" || dueConcept.preparedness === "strong" ? "test_out" : "review", model);
  const nextTask = home.next ? taskFor(snapshot, home.next.taskId) : null;
  if (nextTask) return actionForTask(snapshot, nextTask, now, home, model);
  const objective = snapshot.classes.map((course) => model.recommendLearningObjective({ classId: course.id })).find((candidate) => candidate && !skipped.has(candidate.conceptId));
  if (objective) {
    const state = model.getConceptState(objective.conceptId);
    if (state) return actionForConcept(snapshot, state, now, state.preparedness === "ready" || state.preparedness === "strong" ? "test_out" : "practice", model);
  }
  return {
    id: "next-best:done",
    kind: snapshot.classes.length ? "done" : "notes",
    title: snapshot.classes.length ? "No evidence-backed study move is waiting" : "Capture the next piece of schoolwork",
    conceptIds: [],
    estimatedMinutes: 5,
    reason: { primary: snapshot.classes.length ? "Current tasks and evidence do not identify a safer next move yet." : "Capture keeps the original material durable before filing decisions finish.", factors: [{ id: "state", label: "Current state", detail: "The recommendation engine is abstaining instead of inventing urgency.", weight: 1 }] },
    urgency: 0,
    expectedValue: 0.2,
    confidence: 1,
    evidenceIds: [],
    sourceIds: [],
    completionCriteria: [{ type: "capture", label: "Capture or connect the next academic item." }],
    createdAt: now.toISOString(),
  };
}

function deriveIncompleteLoops(snapshot: Snapshot, now: Date, remediations: RemediationCandidate[], readiness: AssessmentLearningReadiness[]): IncompleteLearningLoop[] {
  const loops: IncompleteLearningLoop[] = [];
  for (const session of snapshot.sessions.filter((item) => item.endedAt).slice(-20)) {
    if (!session.review) {
      loops.push({ id: `session-review:${session.id}`, kind: "session-review", title: "Review the last study session", detail: "The session ended without a short outcome review.", taskId: session.taskId });
    } else if (!session.evidenceAttemptIds?.length) {
      loops.push({ id: `session-evidence:${session.id}`, kind: "session-evidence", title: "Add one checked outcome", detail: "Time was recorded, but no checked attempt changed the Student Model.", taskId: session.taskId });
    }
  }
  for (const remediation of remediations.slice(0, 4)) {
    loops.push({ id: `mistake-correction:${remediation.blockedConceptId}`, kind: "mistake-correction", title: `Repair ${remediation.conceptName}`, detail: remediation.reason, conceptId: remediation.conceptId });
  }
  for (const item of readiness.filter((assessment) => assessment.dueAt && Date.parse(assessment.dueAt) - +now <= 7 * DAY && assessment.state !== "strong")) {
    loops.push({ id: `assessment-coverage:${item.assessmentId}`, kind: "assessment-coverage", title: `${item.title} still has a learning gap`, detail: item.why[0] ?? "Record checked evidence for the assessment concepts.", conceptId: item.weakestConceptId ?? undefined });
  }
  return loops.slice(0, 12);
}

function deriveEffectiveLearning(snapshot: Snapshot, now: Date, windowDays = 14): EffectiveLearning {
  const start = +now - windowDays * DAY;
  const sessions = snapshot.sessions.filter((session) => session.endedAt && Date.parse(session.endedAt) >= start);
  const trackedMinutes = sessions.reduce((sum, session) => sum + Math.max(0, session.actualMinutes ?? 0), 0);
  const scheduledMinutes = sessions.reduce((sum, session) => sum + (session.estimateAtStart?.minutes ?? 0), 0) + snapshot.studyBlocks.filter((block) => !block.cancelledAt && Date.parse(block.start) >= start && Date.parse(block.start) <= +now).reduce((sum, block) => sum + block.minutes, 0);
  const attempts = snapshot.attempts.filter((attempt) => Date.parse(attempt.attemptedAt) >= start);
  const checkedAttempts = attempts.filter((attempt) => attempt.result !== "unknown").length;
  const strongEvidence = attempts.filter((attempt) => attempt.result === "correct" && attempt.unaided && attempt.hintCount === 0 && (attempt.transferDistance ?? 0) >= 0.4).length;
  const completedActivities = sessions.reduce((sum, session) => sum + (session.activityState?.activities.filter((activity) => activity.status === "completed").length ?? 0), 0);
  const engagedMinutes = Math.min(trackedMinutes, Math.round(trackedMinutes * 0.35 + completedActivities * 3 + checkedAttempts * 5));
  const evidenceMinutes = Math.min(trackedMinutes, Math.round(checkedAttempts * 6 + strongEvidence * 6));
  const confidence = strongEvidence >= 3 && checkedAttempts >= 5 ? "high" : checkedAttempts > 0 ? "medium" : sessions.length ? "low" : "low";
  return {
    windowDays,
    scheduledMinutes: Math.round(scheduledMinutes),
    trackedMinutes: Math.round(trackedMinutes),
    engagedMinutes,
    evidenceMinutes,
    checkedAttempts,
    strongEvidence,
    confidence,
    explanation: checkedAttempts ? "Estimated from tracked session time and checked outcomes; elapsed time alone does not raise mastery." : "Tracked time is visible, but no checked outcome is available to estimate productive learning yet.",
  };
}

export function deriveLearningLoop(snapshot: Snapshot, now = new Date(), home = deriveHome(snapshot, now), suppliedModel?: StudentModel): LearningLoopProjection {
  const model = suppliedModel ?? createStudentModel(snapshot, now);
  const remediations = deriveRemediationsWithModel(snapshot, now, model);
  const readiness = assessmentReadiness(snapshot, model, now);
  return {
    nextBestAction: deriveNextBestAction(snapshot, now, home, remediations, readiness, model),
    remediations,
    incompleteLoops: deriveIncompleteLoops(snapshot, now, remediations, readiness),
    effectiveLearning: deriveEffectiveLearning(snapshot, now),
    assessmentReadiness: readiness,
  };
}

/** Pack a finite window using the same recommendation projection as Home. */
export function packAvailableTime(snapshot: Snapshot, availableMinutes: number, now = new Date()): AvailableTimePlan {
  const budget = Math.max(0, Math.floor(availableMinutes));
  if (!budget) return { availableMinutes: 0, blocks: [], unusedMinutes: 0, explanation: "No study window was provided." };
  const projection = deriveLearningLoop(snapshot, now);
  const blocks: PackedTimeBlock[] = [];
  let remaining = budget;
  const add = (action: NextBestAction, minutes: number) => {
    if (remaining <= 0 || minutes <= 0) return;
    const switchingCost = blocks.length ? 2 : 0;
    if (remaining <= switchingCost + 4) return;
    const allocated = Math.min(minutes, remaining - switchingCost);
    if (blocks.length) blocks.push({ startMinute: blocks.at(-1)!.endMinute, endMinute: blocks.at(-1)!.endMinute + switchingCost, minutes: switchingCost, kind: "break", title: "Switch", reason: "A small transition buffer protects the next block.", conceptIds: [] });
    const start = blocks.at(-1)?.endMinute ?? 0;
    blocks.push({ startMinute: start, endMinute: start + allocated, minutes: allocated, kind: action.kind, title: action.title, reason: action.reason.primary, taskId: action.taskId, conceptIds: action.conceptIds });
    remaining -= allocated + switchingCost;
  };
  add(projection.nextBestAction, Math.min(projection.nextBestAction.estimatedMinutes, remaining));
  for (const remediation of projection.remediations) {
    if (!remaining) break;
    add({
      id: remediation.id,
      kind: "remediation",
      title: `Fix ${remediation.conceptName}`,
      conceptIds: [remediation.conceptId],
      estimatedMinutes: remediation.estimatedMinutes,
      reason: { primary: remediation.reason, factors: [] },
      urgency: 0.6,
      expectedValue: 0.6,
      confidence: 0.6,
      evidenceIds: remediation.evidenceIds,
      sourceIds: [],
      completionCriteria: [{ type: "checked-attempt", label: `Check ${remediation.conceptName}.`, conceptIds: [remediation.conceptId] }],
      createdAt: now.toISOString(),
    }, Math.min(remediation.estimatedMinutes, remaining));
  }
  return {
    availableMinutes: budget,
    blocks,
    unusedMinutes: Math.max(0, remaining),
    explanation: blocks.length ? `Packed ${budget - Math.max(0, remaining)} minutes around deadlines, learning risk, and a small switching buffer.` : "No safe action was available for this window.",
  };
}
