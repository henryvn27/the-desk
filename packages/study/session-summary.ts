import type { Attempt, Mistake, StudySession } from "../domain/contracts";
import type { StudySessionSummary } from "./activities";

export function inferSessionSummary(
  session: StudySession,
  attempts: readonly Attempt[],
  mistakes: readonly Mistake[],
  inferredAt = new Date(),
): StudySessionSummary {
  const activities = session.activityState?.activities ?? [];
  const sessionAttempts = attempts.filter((attempt) => session.evidenceAttemptIds?.includes(attempt.id));
  const hintCount = activities.reduce((sum, activity) => sum + activity.hintCount, 0) + sessionAttempts.reduce((sum, attempt) => sum + attempt.hintCount, 0);
  const checkedAttemptCount = sessionAttempts.filter((attempt) => attempt.result !== "unknown").length;
  const unaidedAttemptCount = sessionAttempts.filter((attempt) => attempt.unaided && attempt.result !== "unknown").length;
  const completedActivityCount = activities.filter((activity) => activity.status === "completed").length;
  const skippedActivityCount = activities.filter((activity) => activity.status === "skipped").length;
  const linkedMistakeIds = new Set(activities.flatMap((activity) => activity.mistakeIds));
  const unresolvedMistakes = mistakes.filter(
    (mistake) =>
      linkedMistakeIds.has(mistake.id) ||
      (mistake.taskId === session.taskId && !mistake.practiceTaskIds.includes(session.taskId)),
  ).length;
  const evidenceQuality = checkedAttemptCount >= 2 || (checkedAttemptCount === 1 && unaidedAttemptCount === 1) ? "useful" : checkedAttemptCount ? "light" : "none";
  const nextAction = evidenceQuality === "none"
    ? "record-a-checked-attempt"
    : unresolvedMistakes > 0
      ? "review-a-mistake"
      : activities.some((activity) => activity.kind === "practice" && activity.status !== "completed")
        ? "try-a-transfer-problem"
        : activities.some((activity) => activity.kind === "recall" && activity.status !== "completed")
          ? "retrieve-again-later"
          : "continue-without-change";
  const caveats = [
    session.completionReported === true ? "Task completion was reported by the student; it does not certify mastery or submission." : "The task was left unfinished or completion was not reported.",
    checkedAttemptCount === 0 ? "No checked outcome was recorded, so the Student Model was not updated from this session." : undefined,
    skippedActivityCount > 0 ? `${skippedActivityCount} planned activit${skippedActivityCount === 1 ? "y was" : "ies were"} skipped.` : undefined,
    session.activityState?.mode === "exam" ? "Exam feedback is deferred until after submission." : undefined,
  ].filter((value): value is string => Boolean(value));
  return {
    version: 1,
    inferredAt: inferredAt.toISOString(),
    activityCount: activities.length,
    completedActivityCount,
    skippedActivityCount,
    checkedAttemptCount,
    unaidedAttemptCount,
    hintCount,
    evidenceQuality,
    nextAction,
    caveats,
  };
}
