import { createHash } from "node:crypto";
import type { Snapshot } from "../domain/contracts";
import { deriveHome, type HomeAttention } from "../planner/home";
import { deriveNextAction, type NextAction } from "../planner/next-action";
import { createStudentModel, type ConceptState } from "./student-model";
import { deriveLearningLoop, type LearningLoopProjection, type NextBestAction } from "./learning-loop";

export const DESK_INTELLIGENCE_VERSION = "desk-intelligence-v1" as const;

export type IntelligenceNextAction = NextAction;
export type IntelligenceNextBestAction = NextBestAction;

export type ClassIntelligence = {
  classId: string;
  className: string;
  taskCount: number;
  openTaskCount: number;
  conceptStates: Array<Pick<ConceptState, "conceptId" | "name" | "preparedness" | "competence" | "retrievability" | "evidenceConfidence" | "unresolvedMistakes" | "why">>;
  weakestConceptId: string | null;
  learningObjective: {
    conceptId: string;
    title: string;
    reason: string;
    priority: number;
  } | null;
  assessmentReadiness: Array<{
    assessmentId: string;
    title: string;
    state: string;
    evidenceGaps: string[];
    why: string[];
  }>;
  explanation: string[];
};

export type DeskIntelligence = {
  version: typeof DESK_INTELLIGENCE_VERSION;
  generatedAt: string;
  sourceFingerprint: string;
  nextAction: IntelligenceNextAction;
  nextBestAction: IntelligenceNextBestAction;
  learningLoop: LearningLoopProjection;
  attention: HomeAttention[];
  classes: ClassIntelligence[];
  evidence: {
    attempts: number;
    mistakes: number;
    reviewedSessions: number;
    assessments: number;
  };
  limitations: string[];
};

function sourceFingerprint(snapshot: Snapshot) {
  return createHash("sha256")
    .update(JSON.stringify({
      classes: snapshot.classes,
      tasks: snapshot.tasks,
      assessments: snapshot.assessments,
      concepts: snapshot.concepts,
      attempts: snapshot.attempts,
      mistakes: snapshot.mistakes,
      sessions: snapshot.sessions,
      studyBlocks: snapshot.studyBlocks,
      planChanges: snapshot.planChanges,
      authorityClaims: snapshot.authorityClaims,
      captureInbox: snapshot.captureInbox.map((item) => ({ id: item.id, revision: item.revision, status: item.status })),
      sources: snapshot.sources.map((source) => ({ id: source.id, revision: source.revision, title: source.title })),
      planning: snapshot.planning,
    }))
    .digest("hex");
}

function preparednessRank(value: ConceptState["preparedness"]) {
  return { "not-ready": 0, developing: 1, "mostly-ready": 2, ready: 3, strong: 4 }[value];
}

function classIntelligence(
  snapshot: Snapshot,
  classId: string,
  model: ReturnType<typeof createStudentModel>,
): ClassIntelligence {
  const course = snapshot.classes.find((item) => item.id === classId)!;
  const concepts = snapshot.concepts
    .filter((concept) => concept.classId === classId)
    .map((concept) => model.getConceptState(concept.id))
    .filter((value): value is ConceptState => Boolean(value))
    .sort((a, b) => preparednessRank(a.preparedness) - preparednessRank(b.preparedness) || a.name.localeCompare(b.name));
  const objective = model.recommendLearningObjective({ classId });
  const assessments = snapshot.assessments
    .filter((assessment) => assessment.classId === classId)
    .map((assessment) => {
      const readiness = model.getAssessmentReadiness(assessment.id);
      return {
        assessmentId: assessment.id,
        title: assessment.title,
        state: readiness?.state ?? "not-ready",
        evidenceGaps: readiness?.evidenceGaps.slice(0, 8) ?? ["No linked concept evidence yet."],
        why: readiness?.why.slice(0, 4) ?? ["Link preparation concepts and record a checked attempt."],
      };
    })
    .sort((a, b) => a.state.localeCompare(b.state) || a.title.localeCompare(b.title))
    .slice(0, 8);
  const tasks = snapshot.tasks.filter((task) => task.classId === classId);
  const explanation = objective
    ? [objective.title, objective.reason]
    : concepts.length
      ? ["No single learning objective is selected yet.", "Record a checked attempt to make the Student Model more specific."]
      : ["This class has no concept evidence yet.", "Capture or link course material before drawing a learning conclusion."];
  return {
    classId,
    className: course.name,
    taskCount: tasks.length,
    openTaskCount: tasks.filter((task) => !task.completed).length,
    conceptStates: concepts.slice(0, 24).map((state) => ({
      conceptId: state.conceptId,
      name: state.name,
      preparedness: state.preparedness,
      competence: state.competence,
      retrievability: state.retrievability,
      evidenceConfidence: state.evidenceConfidence,
      unresolvedMistakes: state.unresolvedMistakes,
      why: state.why.slice(0, 4),
    })),
    weakestConceptId: concepts[0]?.conceptId ?? null,
    learningObjective: objective
      ? { conceptId: objective.conceptId, title: objective.title, reason: objective.reason, priority: objective.priority }
      : null,
    assessmentReadiness: assessments,
    explanation,
  };
}

/** Read-only intelligence projection. Canonical tasks, concepts, attempts and sessions remain authoritative. */
export function deriveDeskIntelligence(snapshot: Snapshot, now = new Date()): DeskIntelligence {
  const home = deriveHome(snapshot, now);
  const model = createStudentModel(snapshot, now);
  const learningLoop = deriveLearningLoop(snapshot, now, home, model);
  const classes = snapshot.classes.map((course) => classIntelligence(snapshot, course.id, model));
  return {
    version: DESK_INTELLIGENCE_VERSION,
    generatedAt: now.toISOString(),
    sourceFingerprint: sourceFingerprint(snapshot),
    nextAction: deriveNextAction(snapshot, now, home),
    nextBestAction: learningLoop.nextBestAction,
    learningLoop,
    attention: home.attention,
    classes,
    evidence: {
      attempts: snapshot.attempts.length,
      mistakes: snapshot.mistakes.length,
      reviewedSessions: snapshot.sessions.filter((session) => Boolean(session.review)).length,
      assessments: snapshot.assessments.length,
    },
    limitations: [
      "AI suggestions are advisory and never replace user-confirmed academic facts.",
      "Mastery and readiness require checked student evidence; reading or an AI answer is not counted as performance.",
      "Empty or sparse classes remain explicitly uncertain instead of being filled with model guesses.",
    ],
  };
}
