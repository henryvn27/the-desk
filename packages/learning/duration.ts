import type { StudySession, Task, TaskInput } from "../domain/contracts";

/** Conservative local evidence: a reviewed, unchanged task finished in one session. */
export function durationSuggestion(
  tasks: Task[],
  sessions: StudySession[],
  input: Pick<TaskInput, "classId" | "workKind" | "minutes">,
) {
  if (
    !Number.isFinite(input.minutes) ||
    input.minutes < 5 ||
    input.minutes > 2400
  )
    return null;
  const ratios: number[] = [];
  for (const task of tasks) {
    if (
      !task.completed ||
      task.classId !== input.classId ||
      (task.workKind ?? "assignment") !== (input.workKind ?? "assignment")
    )
      continue;
    const history = sessions.filter((s) => s.taskId === task.id);
    if (history.length !== 1) continue;
    const session = history[0]!;
    const estimate = session.estimateAtStart;
    if (
      !session.endedAt ||
      !session.review ||
      !session.completionReported ||
      !estimate ||
      estimate.taskRevision !== (task.revision ?? 0) ||
      estimate.classId !== task.classId ||
      estimate.workKind !== (task.workKind ?? "assignment") ||
      estimate.minutes !== task.minutes ||
      !Number.isFinite(estimate.minutes) ||
      estimate.minutes < 5 ||
      session.actualMinutes === null ||
      !Number.isFinite(session.actualMinutes) ||
      session.actualMinutes < 5
    )
      continue;
    ratios.push(session.actualMinutes / estimate.minutes);
  }
  if (ratios.length < 3) return null;
  ratios.sort((a, b) => a - b);
  const middle = Math.floor(ratios.length / 2);
  const ratio =
    ratios.length % 2
      ? ratios[middle]!
      : (ratios[middle - 1]! + ratios[middle]!) / 2;
  const minutes = Math.max(
    5,
    Math.min(2400, Math.round((input.minutes * ratio) / 5) * 5),
  );
  return { minutes, ratio, samples: ratios.length };
}
