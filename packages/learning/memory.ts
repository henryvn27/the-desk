import type { Snapshot } from "../domain/contracts";
import { durationEvidence, durationSuggestion } from "./duration";
export function learningSessions(
  state: Pick<Snapshot, "sessions" | "inference">,
) {
  if (!state.inference.enabled) return [];
  const excluded = new Set(state.inference.excludedSessionIds);
  const excludedTasks = new Set(
    state.sessions
      .filter((session) => excluded.has(session.id))
      .map((session) => session.taskId),
  );
  return state.sessions.filter((session) => !excludedTasks.has(session.taskId));
}
export function durationMemories(state: Snapshot) {
  const sessions = learningSessions(state);
  return state.classes.flatMap((course) =>
    (["assignment", "assessment", "optional-review"] as const).flatMap(
      (workKind) => {
        const key = course.id + ":" + workKind;
        if (state.memories.some((memory) => memory.inferenceKey === key))
          return [];
        const input = { classId: course.id, workKind, minutes: 30 };
        const result = durationSuggestion(state.tasks, sessions, input);
        if (!result) return [];
        const evidence = durationEvidence(state.tasks, sessions, input);
        return [
          {
            key,
            classId: course.id,
            workKind,
            basis: JSON.stringify(evidence),
            text: `Reviewed ${workKind} work in ${course.name} took a median ${result.ratio.toFixed(2)} times the initial estimate across ${result.samples} tasks.`,
            evidence: {
              sessionIds: evidence.map((item) => item.sessionId),
              ratio: result.ratio,
              samples: result.samples,
            },
          },
        ];
      },
    ),
  );
}
