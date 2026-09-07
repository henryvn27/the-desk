import type { Snapshot } from "../domain/contracts";
import { createStudentModel } from "../intelligence/student-model";
import { deriveHome, type HomeProjection } from "./home";

/**
 * The single executable recommendation shared by Home, Plan and class views.
 *
 * This is a projection only. Tasks, sessions, concepts and plan blocks remain
 * authoritative in SQLite; the recommendation can always be recomputed from a
 * snapshot. Keeping the decision here prevents each surface from inventing a
 * slightly different priority rule.
 */
export type NextActionKind =
  | "active-session"
  | "start-task"
  | "resolve-attention"
  | "study-objective"
  | "capture";

export type NextActionUrgency = "now" | "today" | "soon" | "none";

export type NextActionButton = {
  id: "start" | "resume" | "review" | "capture";
  label: string;
};

export type NextAction = {
  kind: NextActionKind;
  title: string;
  reason: string;
  estimatedMinutes?: number;
  urgency: NextActionUrgency;
  confidence: number;
  evidence: string[];
  actions: NextActionButton[];
  sessionId?: string;
  taskId?: string;
  classId?: string;
  attentionId?: string;
  conceptId?: string;
};

function taskFor(snapshot: Snapshot, taskId: string) {
  return snapshot.tasks.find((task) => task.id === taskId);
}

function className(snapshot: Snapshot, classId: string | undefined) {
  return classId
    ? snapshot.classes.find((course) => course.id === classId)?.name
    : undefined;
}

function urgencyForBlock(block: HomeProjection["next"], now: Date): NextActionUrgency {
  if (!block) return "none";
  const start = Date.parse(block.start);
  return start <= +now ? "now" : new Date(start).toDateString() === now.toDateString() ? "today" : "soon";
}

function objectiveEvidence(
  snapshot: Snapshot,
  conceptId: string,
  reason: string,
) {
  const concept = snapshot.concepts.find((candidate) => candidate.id === conceptId);
  return [
    concept ? `${concept.name} is linked to this class.` : "The objective comes from the Student Model.",
    reason,
    "Only checked work contributes to this learning signal.",
  ];
}

export function deriveNextAction(
  snapshot: Snapshot,
  now = new Date(),
  home: HomeProjection = deriveHome(snapshot, now),
): NextAction {
  const active = snapshot.sessions.find((session) => !session.endedAt);
  if (active) {
    const task = taskFor(snapshot, active.taskId);
    const course = className(snapshot, task?.classId);
    return {
      kind: "active-session",
      title: task ? `Continue ${task.title}` : "Continue the active study session",
      reason: "An active session already owns the study controls; return to the compact controller to keep working.",
      urgency: "now",
      confidence: 1,
      evidence: [
        "A study session is already active.",
        ...(course ? [`Current class: ${course}.`] : []),
      ],
      actions: [{ id: "resume", label: "Open study controller" }],
      sessionId: active.id,
      taskId: active.taskId,
      ...(task?.classId ? { classId: task.classId } : {}),
    };
  }

  if (home.next) {
    const task = taskFor(snapshot, home.next.taskId);
    const course = className(snapshot, task?.classId);
    const evidence = [
      "The Planner selected the earliest executable block.",
      home.next.why,
      ...(task?.dueAt && task.deadlineConfirmed
        ? [`Confirmed deadline: ${new Date(task.dueAt).toLocaleString()}.`]
        : []),
      ...(course ? [`Class: ${course}.`] : []),
    ];
    return {
      kind: "start-task",
      title: task?.title ?? "Start the next planned block",
      reason: home.next.why,
      estimatedMinutes: home.next.minutes,
      urgency: urgencyForBlock(home.next, now),
      confidence: 0.96,
      evidence: evidence.filter((item, index) => item && evidence.indexOf(item) === index).slice(0, 5),
      actions: [{ id: "start", label: "Start" }],
      taskId: home.next.taskId,
      ...(task?.classId ? { classId: task.classId } : {}),
    };
  }

  const attention = home.attention[0];
  if (attention) {
    return {
      kind: "resolve-attention",
      title: attention.title,
      reason: attention.detail,
      urgency: "today",
      confidence: 0.94,
      evidence: [attention.detail],
      actions: [{ id: "review", label: "Review" }],
      attentionId: attention.id,
      ...(attention.taskId ? { taskId: attention.taskId } : {}),
    };
  }

  const model = createStudentModel(snapshot, now);
  for (const course of snapshot.classes) {
    const objective = model.recommendLearningObjective({ classId: course.id });
    if (!objective) continue;
    const state = model.getConceptState(objective.conceptId);
    return {
      kind: "study-objective",
      title: objective.title,
      reason: objective.reason,
      urgency: "soon",
      confidence: state?.evidenceConfidence.value ?? 0.55,
      evidence: objectiveEvidence(snapshot, objective.conceptId, objective.reason),
      actions: [{ id: "start", label: "Review" }],
      classId: course.id,
      conceptId: objective.conceptId,
    };
  }

  return {
    kind: "capture",
    title: "Capture the next piece of schoolwork",
    reason: "There is no executable task or evidence-backed study objective yet.",
    urgency: "none",
    confidence: 1,
    evidence: [
      snapshot.classes.length ? "No current plan block is executable." : "No class has been added yet.",
      "Capture keeps the original material durable before filing decisions finish.",
    ],
    actions: [{ id: "capture", label: "Capture" }],
  };
}
