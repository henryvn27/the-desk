import type { Mistake, Snapshot, Task } from "../domain/contracts";

/** Explicit associations only; class-wide notes are distinct from assignment sources. */
export function sessionKit(
  task: Task,
  state: Pick<Snapshot, "sources" | "sessions"> & { mistakes?: Mistake[] },
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
  return { linkedSources, classSources, previousReviews, mistakes };
}
