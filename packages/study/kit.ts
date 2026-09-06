import type { Snapshot, Task } from "../domain/contracts";

/** Explicit associations only; class-wide notes are distinct from assignment sources. */
export function sessionKit(
  task: Task,
  state: Pick<Snapshot, "sources" | "sessions">,
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
  return { linkedSources, classSources, previousReviews };
}
