import type {
  Assessment,
  Attempt,
  Concept,
  Mistake,
  Snapshot,
  Task,
  TeacherEvidence,
} from "../domain/contracts";

/** Explicit associations only; class-wide notes are distinct from assignment sources. */
export function sessionKit(
  task: Task,
  state: Pick<Snapshot, "sources" | "sessions"> & {
    assessments?: Assessment[];
    mistakes?: Mistake[];
    concepts?: Concept[];
    attempts?: Attempt[];
    teacherEvidence?: TeacherEvidence[];
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
  const concepts = [...(state.concepts ?? [])]
    .filter((concept) => {
      if (concept.classId !== task.classId) return false;
      const linked = concept.taskIds.includes(task.id);
      const weak =
        concept.preparedness === "not-ready" ||
        concept.preparedness === "developing" ||
        concept.status === "review-due";
      const due =
        concept.reviewDue !== null &&
        Date.parse(concept.reviewDue) <= Date.now();
      return linked || weak || due;
    })
    .sort(
      (a, b) =>
        Number(b.taskIds.includes(task.id)) -
          Number(a.taskIds.includes(task.id)) ||
        (a.reviewDue ? Date.parse(a.reviewDue) : Infinity) -
          (b.reviewDue ? Date.parse(b.reviewDue) : Infinity) ||
        a.name.localeCompare(b.name),
    );
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
  return {
    linkedSources,
    classSources,
    previousReviews,
    mistakes,
    concepts,
    attempts,
    assessments,
    teacherEvidence,
  };
}
