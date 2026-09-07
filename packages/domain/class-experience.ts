import { gradeSummary } from "../grades";
import { createStudentModel } from "../intelligence/student-model";
import { planWeek, type GradeData } from "../planner";
import type {
  Assessment,
  Class as ClassRecord,
  Concept,
  GradeCategory,
  GradeEntry,
  Snapshot,
  Task,
  Unit,
} from "./contracts";

/**
 * Read-only presentation data for a class. This intentionally remains a
 * projection over the V1 academic graph; it is not another Course model.
 */
export type ClassUnitStage = "past" | "current" | "upcoming";

export type ClassUnitView = {
  id: string;
  name: string;
  kind: Unit["kind"];
  sequence: number;
  trackName?: string;
  stage: ClassUnitStage;
  taskCount: number;
  completedTaskCount: number;
  remainingMinutes: number;
  conceptNames: string[];
};

export type ClassNextView = {
  taskId: string;
  title: string;
  minutes: number;
  start?: string;
  end?: string;
  dueAt: string | null;
  deadlineConfirmed: boolean;
  why: string;
  kind: "planned" | "needs-confirmation" | "unscheduled";
  unitName?: string;
  assessmentTitle?: string;
};

export type ClassAssessmentView = {
  id: string;
  title: string;
  kind: Assessment["kind"];
  dueAt: string | null;
  gradeCategoryName?: string;
  taskIds: string[];
  taskTitles: string[];
  unitNames: string[];
  conceptNames: string[];
  sourceTitles: string[];
  mistakeCount: number;
  plannedMinutes: number;
  preparedness?: string;
  readinessWhy: string[];
  teacherEvidenceCount: number;
};

export type ClassLearningView = {
  id: string;
  name: string;
  recordedStatus: Concept["status"];
  preparedness: Concept["preparedness"];
  evidenceConfidence: "insufficient" | "low" | "medium" | "high";
  unresolvedMistakes: number;
  reviewDue: string | null;
  why: string[];
};

export type ClassTeacherEvidenceView = {
  id: string;
  title: string;
  capturedAt: string;
  assessmentTitle?: string;
  taskTitle?: string;
  comments: string;
  score?: string;
};

export type ClassTeacherView = {
  id: string;
  name: string;
  email: string | null;
  notes: string;
  evidenceCount: number;
  recordedEmphasis: { name: string; count: number }[];
  recentEvidence: ClassTeacherEvidenceView[];
};

export type ClassSourceView = {
  id: string;
  title: string;
  kind: string;
  format: string;
  revision: number;
  annotationCount: number;
};

export type ClassNoteView = {
  id: string;
  title: string;
  taskId: string;
  taskTitle: string;
  updatedAt: string;
  blockId?: string;
};

export type ClassAttentionView = {
  id: string;
  taskId?: string;
  title: string;
  detail: string;
  kind: "authority-conflict" | "capture-review" | "missing-structure";
};

export type ClassGradeView = {
  lower: number;
  upper: number;
  configuredWeight: number;
  scoredWeight: number;
  unknownCategories: string[];
  categories: GradeCategory[];
  entries: GradeEntry[];
};

export type ClassExperienceProjection = {
  classRecord: ClassRecord;
  periods: string[];
  spaces: string[];
  units: {
    past: ClassUnitView[];
    current: ClassUnitView[];
    upcoming: ClassUnitView[];
  };
  next?: ClassNextView;
  assessments: ClassAssessmentView[];
  learning: ClassLearningView[];
  teachers: ClassTeacherView[];
  sources: ClassSourceView[];
  notes: ClassNoteView[];
  attention: ClassAttentionView[];
  grade: ClassGradeView;
  plan: ReturnType<typeof planWeek>;
  tasks: Task[];
};

const preparednessRank: Record<Concept["preparedness"], number> = {
  "not-ready": 0,
  developing: 1,
  "mostly-ready": 2,
  ready: 3,
  strong: 4,
};

const evidenceConfidenceRank: Record<"insufficient" | "low" | "medium" | "high", number> = {
  insufficient: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function taskFor(tasks: readonly Task[], id: string) {
  return tasks.find((task) => task.id === id);
}

function taskUnitId(units: readonly Unit[], taskId: string) {
  return units.find((unit) => unit.taskIds.includes(taskId))?.id;
}

function distinct<T>(items: T[]) {
  return [...new Set(items)];
}

function intersects(left: readonly string[], right: readonly string[]) {
  return left.some((value) => right.includes(value));
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function sourceBelongsToClass(
  source: Snapshot["sources"][number],
  classId: string,
  classTaskIds: ReadonlySet<string>,
) {
  return (
    source.classIds.includes(classId) ||
    source.taskIds.some((taskId) => classTaskIds.has(taskId))
  );
}

function unitViews(snapshot: Snapshot, classId: string, tasks: Task[]) {
  const ordered = snapshot.units
    .filter((unit) => unit.classId === classId)
    .sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));
  const currentIndex = ordered.findIndex((unit) =>
    unit.taskIds.some((taskId) => taskFor(tasks, taskId)?.completed === false),
  );
  const views = ordered.map((unit, index): ClassUnitView => {
    const unitTasks = unit.taskIds
      .map((taskId) => taskFor(tasks, taskId))
      .filter((task): task is Task => Boolean(task));
    const concepts = snapshot.concepts
      .filter((concept) => concept.classId === classId && intersects(concept.taskIds, unit.taskIds))
      .map((concept) => concept.name);
    const track = unit.trackId
      ? snapshot.tracks.find((candidate) => candidate.id === unit.trackId)?.name
      : undefined;
    const stage: ClassUnitStage =
      currentIndex < 0 || index < currentIndex
        ? "past"
        : index === currentIndex
          ? "current"
          : "upcoming";
    return {
      id: unit.id,
      name: unit.name,
      kind: unit.kind,
      sequence: unit.sequence,
      ...(track ? { trackName: track } : {}),
      stage,
      taskCount: unitTasks.length,
      completedTaskCount: unitTasks.filter((task) => task.completed).length,
      remainingMinutes: unitTasks
        .filter((task) => !task.completed)
        .reduce((sum, task) => sum + task.minutes, 0),
      conceptNames: distinct(concepts),
    };
  });
  return {
    past: views.filter((unit) => unit.stage === "past"),
    current: views.filter((unit) => unit.stage === "current"),
    upcoming: views.filter((unit) => unit.stage === "upcoming"),
  };
}

function nextView(
  snapshot: Snapshot,
  tasks: Task[],
  units: ReturnType<typeof unitViews>,
  plan: ReturnType<typeof planWeek>,
  now: Date,
): ClassNextView | undefined {
  const unitById = new Map(
    [...units.past, ...units.current, ...units.upcoming].map((unit) => [unit.id, unit]),
  );
  const assessmentForTask = (taskId: string) =>
    snapshot.assessments.find((assessment) => assessment.taskIds.includes(taskId));
  const planned = [
    ...snapshot.studyBlocks
      .filter((block) => {
        const task = taskFor(tasks, block.taskId);
        return !block.cancelledAt && Boolean(task && !task.completed);
      })
      .map((block) => ({
        taskId: block.taskId,
        start: block.start,
        end: block.end,
        minutes: block.minutes,
        why: block.why,
      })),
    ...plan.blocks,
  ]
    .filter((block) => Date.parse(block.end) > +now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (planned) {
    const task = taskFor(tasks, planned.taskId);
    if (!task) return undefined;
    const unit = taskUnitId(snapshot.units, task.id);
    const assessment = assessmentForTask(task.id);
    return {
      taskId: task.id,
      title: task.title,
      minutes: planned.minutes,
      start: planned.start,
      end: planned.end,
      dueAt: task.dueAt,
      deadlineConfirmed: task.deadlineConfirmed,
      why: planned.why,
      kind: "planned",
      ...(unit && unitById.get(unit)?.name ? { unitName: unitById.get(unit)!.name } : {}),
      ...(assessment ? { assessmentTitle: assessment.title } : {}),
    };
  }
  const unscheduled = plan.unscheduled
    .map((item) => ({ item, task: taskFor(tasks, item.taskId) }))
    .find((candidate) => candidate.task && !candidate.task.completed);
  if (unscheduled?.task) {
    const unit = taskUnitId(snapshot.units, unscheduled.task.id);
    const assessment = assessmentForTask(unscheduled.task.id);
    return {
      taskId: unscheduled.task.id,
      title: unscheduled.task.title,
      minutes: unscheduled.item.minutes,
      dueAt: unscheduled.task.dueAt,
      deadlineConfirmed: unscheduled.task.deadlineConfirmed,
      why: unscheduled.item.reason,
      kind: unscheduled.item.reason.startsWith("Confirm the deadline")
        ? "needs-confirmation"
        : "unscheduled",
      ...(unit && unitById.get(unit)?.name ? { unitName: unitById.get(unit)!.name } : {}),
      ...(assessment ? { assessmentTitle: assessment.title } : {}),
    };
  }
  const fallback = tasks
    .filter((task) => !task.completed)
    .sort(
      (a, b) =>
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
        a.createdAt.localeCompare(b.createdAt),
    )[0];
  if (!fallback) return undefined;
  return {
    taskId: fallback.id,
    title: fallback.title,
    minutes: fallback.minutes,
    dueAt: fallback.dueAt,
    deadlineConfirmed: fallback.deadlineConfirmed,
    why: "This work is not in a current executable block. Review the plan before starting it.",
    kind: "unscheduled",
  };
}

function assessmentViews(
  snapshot: Snapshot,
  classId: string,
  tasks: Task[],
  units: ReturnType<typeof unitViews>,
  plan: ReturnType<typeof planWeek>,
  now: Date,
) {
  const classUnits = [...units.past, ...units.current, ...units.upcoming];
  const classTaskIds = new Set(tasks.map((task) => task.id));
  const gradeCategories = snapshot.gradeCategories.filter((category) => category.classId === classId);
  const model = createStudentModel(snapshot);
  return [...snapshot.assessments]
    .filter((assessment) => assessment.classId === classId)
    .sort(
      (a, b) =>
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
        a.title.localeCompare(b.title),
    )
    .map((assessment): ClassAssessmentView => {
      const linkedTasks = tasks.filter((task) => assessment.taskIds.includes(task.id));
      const linkedUnitIds = snapshot.units
        .filter((unit) => unit.classId === classId && intersects(unit.taskIds, assessment.taskIds))
        .map((unit) => unit.id);
      const linkedConcepts = snapshot.concepts.filter(
        (concept) =>
          concept.classId === classId &&
          (intersects(concept.taskIds, assessment.taskIds) ||
            snapshot.attempts.some(
              (attempt) =>
                attempt.conceptIds.includes(concept.id) &&
                attempt.taskId !== null &&
                assessment.taskIds.includes(attempt.taskId),
            )),
      );
      const assessmentSources = snapshot.sources.filter(
        (source) =>
          sourceBelongsToClass(source, classId, classTaskIds) &&
          (source.classIds.includes(classId) || intersects(source.taskIds, assessment.taskIds)),
      );
      const conceptNames = new Set(linkedConcepts.map((concept) => normalize(concept.name)));
      const mistakes = snapshot.mistakes.filter(
        (mistake) =>
          mistake.classId === classId &&
          (assessment.taskIds.includes(mistake.taskId ?? "") ||
            mistake.practiceTaskIds.some((taskId) => assessment.taskIds.includes(taskId)) ||
            conceptNames.has(normalize(mistake.concept))),
      );
      const readiness = model.getAssessmentReadiness(assessment.id);
      const linkedTeacherEvidence = snapshot.teacherEvidence.filter(
        (evidence) =>
          evidence.classId === classId &&
          (evidence.assessmentId === assessment.id ||
            (evidence.taskId !== null && assessment.taskIds.includes(evidence.taskId))),
      );
      return {
        id: assessment.id,
        title: assessment.title,
        kind: assessment.kind,
        dueAt: assessment.dueAt,
        ...(gradeCategories.find((category) => category.id === assessment.gradeCategoryId)?.name
          ? { gradeCategoryName: gradeCategories.find((category) => category.id === assessment.gradeCategoryId)!.name }
          : {}),
        taskIds: [...assessment.taskIds],
        taskTitles: linkedTasks.map((task) => task.title),
        unitNames: linkedUnitIds
          .map((id) => classUnits.find((unit) => unit.id === id)?.name)
          .filter((name): name is string => Boolean(name)),
        conceptNames: linkedConcepts.map((concept) => concept.name),
        sourceTitles: assessmentSources.map((source) => source.title),
        mistakeCount: mistakes.length,
        plannedMinutes: [
          ...snapshot.studyBlocks.filter(
            (block) =>
              !block.cancelledAt &&
              Date.parse(block.end) > +now &&
              assessment.taskIds.includes(block.taskId),
          ),
          ...plan.blocks,
        ]
          .filter((block) => assessment.taskIds.includes(block.taskId))
          .reduce((sum, block) => sum + block.minutes, 0),
        ...(readiness
          ? {
              preparedness: readiness.state,
              readinessWhy: readiness.why.slice(0, 3),
            }
          : { readinessWhy: [] }),
        teacherEvidenceCount: linkedTeacherEvidence.length,
      };
    });
}

function learningViews(snapshot: Snapshot, classId: string) {
  const model = createStudentModel(snapshot);
  return snapshot.concepts
    .filter((concept) => concept.classId === classId)
    .map((concept): ClassLearningView => {
      const derived = model.getConceptState(concept.id);
      const review = model.getReviewDue(concept.id);
      return {
        id: concept.id,
        name: concept.name,
        recordedStatus: concept.status,
        preparedness: derived?.preparedness ?? concept.preparedness,
        evidenceConfidence: derived?.evidenceConfidence.label ?? "insufficient",
        unresolvedMistakes: derived?.unresolvedMistakes ?? 0,
        reviewDue: review.dueAt,
        why: derived?.why.slice(0, 3) ?? ["No checked evidence is linked yet."],
      };
    })
    .sort(
      (a, b) =>
        preparednessRank[a.preparedness] - preparednessRank[b.preparedness] ||
        evidenceConfidenceRank[a.evidenceConfidence] - evidenceConfidenceRank[b.evidenceConfidence] ||
        a.name.localeCompare(b.name),
    );
}

function teacherViews(snapshot: Snapshot, classId: string, concepts: Concept[]) {
  const conceptNames = new Map(concepts.map((concept) => [concept.id, concept.name]));
  return snapshot.teachers
    .filter((teacher) => teacher.classIds.includes(classId))
    .map((teacher): ClassTeacherView => {
      const evidence = snapshot.teacherEvidence
        .filter((item) => item.classId === classId && item.teacherId === teacher.id)
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
      const emphasis = new Map<string, number>();
      for (const item of evidence) {
        if (!item.includeInTeacherModeling) continue;
        for (const conceptId of item.conceptIds) {
          const name = conceptNames.get(conceptId);
          if (name) emphasis.set(name, (emphasis.get(name) ?? 0) + 1);
        }
      }
      return {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
        notes: teacher.notes,
        evidenceCount: evidence.length,
        recordedEmphasis: [...emphasis.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        recentEvidence: evidence.slice(0, 3).map((item): ClassTeacherEvidenceView => ({
          id: item.id,
          title: item.title,
          capturedAt: item.capturedAt,
          ...(item.assessmentId
            ? { assessmentTitle: snapshot.assessments.find((assessment) => assessment.id === item.assessmentId)?.title }
            : {}),
          ...(item.taskId
            ? { taskTitle: taskFor(snapshot.tasks, item.taskId)?.title }
            : {}),
          comments: item.teacherComments || item.observations || item.rubric,
          ...(item.scoreEarned !== null && item.scorePossible !== null
            ? { score: `${item.scoreEarned}/${item.scorePossible}` }
            : {}),
        })),
      };
    });
}

function sourceViews(snapshot: Snapshot, classId: string, tasks: Task[]) {
  const taskIds = new Set(tasks.map((task) => task.id));
  return snapshot.sources
    .filter((source) => sourceBelongsToClass(source, classId, taskIds))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((source): ClassSourceView => ({
      id: source.id,
      title: source.title,
      kind: source.kind ?? "unspecified",
      format: source.format ?? "text",
      revision: source.revision ?? 0,
      annotationCount: source.annotations?.length ?? 0,
    }));
}

function noteViews(snapshot: Snapshot, classId: string, tasks: Task[]) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const noteRefs = new Map<string, string>();
  for (const source of snapshot.sources) {
    for (const annotation of source.annotations ?? []) {
      for (const ref of annotation.noteRefs) noteRefs.set(ref.canvasId, ref.blockId);
    }
  }
  return snapshot.canvases
    .filter((canvas) => taskMap.has(canvas.taskId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((canvas): ClassNoteView => ({
      id: canvas.id,
      title: canvas.title,
      taskId: canvas.taskId,
      taskTitle: taskMap.get(canvas.taskId)!.title,
      updatedAt: canvas.updatedAt,
      ...(noteRefs.has(canvas.id) ? { blockId: noteRefs.get(canvas.id) } : {}),
    }));
}

function attentionViews(snapshot: Snapshot, classId: string, tasks: Task[]) {
  const result: ClassAttentionView[] = [];
  for (const task of tasks) {
    const claims = snapshot.authorityClaims.filter(
      (claim) =>
        claim.classId === classId &&
        claim.taskId === task.id &&
        !snapshot.authorityResolutions.some(
          (resolution) => resolution.claimId === claim.id,
        ),
    );
    if (claims.length > 0) {
      result.push({
        id: `authority:${task.id}`,
        taskId: task.id,
        title: claims.length > 1 ? `${task.title} has competing deadlines` : `${task.title} has an unresolved deadline claim`,
        detail: claims.map((claim) => `${claim.sourceLabel}: ${claim.value ? new Date(claim.value).toLocaleString() : "no date"}`).join(" · "),
        kind: "authority-conflict",
      });
    }
    const confidenceValues = Object.values(task.captureEvidence?.confidence ?? {});
    const uncertainties = task.captureEvidence?.uncertainties ?? [];
    if (confidenceValues.includes("low") || uncertainties.length > 0) {
      result.push({
        id: `capture:${task.id}`,
        taskId: task.id,
        title: `${task.title} needs a quick review`,
        detail: uncertainties[0] ?? "Capture confidence is low for part of this assignment.",
        kind: "capture-review",
      });
    }
  }
  if (!snapshot.units.some((unit) => unit.classId === classId) && tasks.length > 1) {
    result.push({
      id: `structure:${classId}`,
      title: "Class progression is still unstructured",
      detail: "Add units or modules when the syllabus gives you a reliable sequence.",
      kind: "missing-structure",
    });
  }
  return result.slice(0, 6);
}

export function deriveClassExperience(
  snapshot: Snapshot,
  classId: string,
  now = new Date(),
): ClassExperienceProjection | undefined {
  const classRecord = snapshot.classes.find((candidate) => candidate.id === classId);
  if (!classRecord) return undefined;
  const tasks = snapshot.tasks.filter((task) => task.classId === classId);
  const units = unitViews(snapshot, classId, tasks);
  const gradeData: GradeData = {
    gradeCategories: snapshot.gradeCategories,
    gradeEntries: snapshot.gradeEntries,
    mistakes: snapshot.mistakes,
    concepts: snapshot.concepts,
    assessments: snapshot.assessments,
    sessions: snapshot.sessions,
    attempts: snapshot.attempts,
    teacherEvidence: snapshot.teacherEvidence,
    tasks: snapshot.tasks,
  };
  const plan = planWeek(
    tasks,
    now,
    snapshot.planning,
    snapshot.studyBlocks.filter((block) => tasks.some((task) => task.id === block.taskId)),
    gradeData,
  );
  const categories = snapshot.gradeCategories.filter((category) => category.classId === classId);
  const entries = snapshot.gradeEntries.filter((entry) => categories.some((category) => category.id === entry.categoryId));
  const summary = gradeSummary(categories, entries);
  return {
    classRecord,
    periods: snapshot.academicPeriods.filter((period) => period.classIds.includes(classId)).map((period) => period.name),
    spaces: snapshot.spaces.filter((space) => space.classIds.includes(classId)).map((space) => space.name),
    units,
    next: nextView(snapshot, tasks, units, plan, now),
    assessments: assessmentViews(snapshot, classId, tasks, units, plan, now),
    learning: learningViews(snapshot, classId),
    teachers: teacherViews(snapshot, classId, snapshot.concepts.filter((concept) => concept.classId === classId)),
    sources: sourceViews(snapshot, classId, tasks),
    notes: noteViews(snapshot, classId, tasks),
    attention: attentionViews(snapshot, classId, tasks),
    grade: {
      lower: summary.lower,
      upper: summary.upper,
      configuredWeight: summary.configuredWeight,
      scoredWeight: summary.scoredWeight,
      unknownCategories: summary.rows.filter((row) => row.percent === null).map((row) => row.name),
      categories,
      entries,
    },
    plan,
    tasks,
  };
}
