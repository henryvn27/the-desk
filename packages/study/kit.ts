import type {
  Assessment,
  AcademicPeriod,
  Attempt,
  Concept,
  Mistake,
  Snapshot,
  Task,
  Teacher,
  TeacherEvidence,
  Space,
  Track,
  Unit,
} from "../domain/contracts";
import {
  createStudentModel,
  type ConceptState,
} from "../intelligence/student-model";
import { planStudyActivities } from "./activities";

/** Explicit associations only; class-wide notes are distinct from assignment sources. */
export function sessionKit(
  task: Task,
  state: Pick<Snapshot, "sources" | "sessions"> & {
    assessments?: Assessment[];
    academicPeriods?: AcademicPeriod[];
    spaces?: Space[];
    mistakes?: Mistake[];
    concepts?: Concept[];
    attempts?: Attempt[];
    teachers?: Teacher[];
    teacherEvidence?: TeacherEvidence[];
    tracks?: Track[];
    units?: Unit[];
    tasks?: Task[];
  },
) {
  const linkedSources = state.sources.filter((source) =>
    source.taskIds.includes(task.id),
  );
  const classSources = state.sources.filter(
    (source) =>
      source.taskIds.length === 0 && source.classIds.includes(task.classId),
  );
  const previousReviews = state.sessions
    .filter(
      (session) =>
        session.taskId === task.id &&
        session.endedAt &&
        session.review?.notes.trim(),
    )
    .slice(-3)
    .reverse();
  const mistakes = [...(state.mistakes ?? [])]
    .filter((mistake) => mistake.classId === task.classId)
    .sort(
      (a, b) =>
        (a.reviewDue ? Date.parse(a.reviewDue) : Infinity) -
          (b.reviewDue ? Date.parse(b.reviewDue) : Infinity) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  const model = createStudentModel({
    concepts: state.concepts ?? [],
    attempts: state.attempts ?? [],
    mistakes: state.mistakes ?? [],
    sessions: state.sessions,
    assessments: state.assessments ?? [],
    teacherEvidence: state.teacherEvidence ?? [],
    tasks: [task, ...(state.tasks ?? [])],
  });
  const conceptStates = new Map<string, ConceptState>();
  for (const concept of state.concepts ?? []) {
    const derived = model.getConceptState(concept.id);
    if (derived) conceptStates.set(concept.id, derived);
  }
  const concepts = [...(state.concepts ?? [])]
    .filter((concept) => {
      if (concept.classId !== task.classId) return false;
      const linked = concept.taskIds.includes(task.id);
      const derived = conceptStates.get(concept.id);
      const weak =
        derived?.preparedness === "not-ready" ||
        derived?.preparedness === "developing" ||
        concept.status === "review-due";
      const due = model.getReviewDue(concept.id).status === "due";
      return linked || weak || due;
    })
    .sort(
      (a, b) =>
        Number(b.taskIds.includes(task.id)) -
          Number(a.taskIds.includes(task.id)) ||
        (model.getReviewDue(a.id).dueAt
          ? Date.parse(model.getReviewDue(a.id).dueAt!)
          : Infinity) -
          (model.getReviewDue(b.id).dueAt
            ? Date.parse(model.getReviewDue(b.id).dueAt!)
            : Infinity) ||
        a.name.localeCompare(b.name),
    );
  const objective = model.recommendLearningObjective({ taskId: task.id });
  const searchText = `${task.title} ${task.notes} ${objective?.title ?? ""}`.toLocaleLowerCase();
  const referenceSources = [...classSources]
    .map((source) => {
      const sourceText = `${source.title} ${source.text}`.toLocaleLowerCase();
      const lexicalMatches = searchText
        .split(/\s+/)
        .filter((term) => term.length >= 4 && sourceText.includes(term)).length;
      return { source, score: lexicalMatches * 2 + (source.taskIds.includes(task.id) ? 10 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.source.title.localeCompare(b.source.title))
    .slice(0, 8)
    .map(({ source }) => source);
  const recommendedActivities = planStudyActivities(
    task,
    {
      sources: state.sources,
      sessions: state.sessions,
      assessments: state.assessments ?? [],
      concepts: state.concepts ?? [],
      attempts: state.attempts ?? [],
      mistakes: state.mistakes ?? [],
      teacherEvidence: state.teacherEvidence ?? [],
      tasks: state.tasks ?? [task],
    },
    "standard",
    new Date(0),
  ).activities;
  const attempts = [...(state.attempts ?? [])]
    .filter(
      (attempt) =>
        attempt.classId === task.classId && attempt.taskId === task.id,
    )
    .sort(
      (a, b) =>
        Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt) ||
        b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 5);
  const assessments = [...(state.assessments ?? [])]
    .filter(
      (assessment) =>
        assessment.classId === task.classId &&
        assessment.taskIds.includes(task.id),
    )
    .sort(
      (a, b) =>
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
        a.title.localeCompare(b.title),
    );
  const academicPeriods = [...(state.academicPeriods ?? [])].filter((period) =>
    period.classIds.includes(task.classId),
  );
  const spaces = [...(state.spaces ?? [])].filter((space) =>
    space.classIds.includes(task.classId),
  );
  const teacherEvidence = [...(state.teacherEvidence ?? [])]
    .filter((evidence) => {
      if (evidence.classId !== task.classId) return false;
      const linkedTask = evidence.taskId === task.id;
      const linkedAssessment = assessments.some(
        (assessment) => assessment.id === evidence.assessmentId,
      );
      return linkedTask || linkedAssessment;
    })
    .sort(
      (a, b) =>
        Date.parse(b.capturedAt) - Date.parse(a.capturedAt) ||
        b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 5);
  const teachers = [...(state.teachers ?? [])].filter((teacher) =>
    teacher.classIds.includes(task.classId),
  );
  const units = [...(state.units ?? [])]
    .filter(
      (unit) => unit.classId === task.classId && unit.taskIds.includes(task.id),
    )
    .sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));
  const tracks = [...(state.tracks ?? [])].filter(
    (track) =>
      track.classId === task.classId &&
      units.some((unit) => unit.trackId === track.id),
  );
  return {
    linkedSources,
    classSources,
    referenceSources,
    previousReviews,
    mistakes,
    concepts,
    attempts,
    assessments,
    academicPeriods,
    spaces,
    teachers,
    teacherEvidence,
    tracks,
    units,
    conceptStates: concepts
      .map((concept) => conceptStates.get(concept.id))
      .filter((concept): concept is ConceptState => Boolean(concept)),
    objective,
    recommendedActivities,
  };
}
