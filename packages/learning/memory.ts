import type { AcademicMemory, Snapshot } from "../domain/contracts";
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
              observations: evidence,
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

export function inferenceEvidenceCurrent(
  memory: AcademicMemory,
  state: Pick<Snapshot, "tasks" | "sessions">,
): boolean {
  if (memory.origin !== "inferred") return true;
  const observations = memory.evidence?.observations;
  if (!observations?.length) return false;
  const first = observations[0]!;
  const current = new Map(
    durationEvidence(state.tasks, state.sessions, {
      classId: first.classId,
      workKind: first.workKind,
      minutes: 30,
    }).map((item) => [item.sessionId, item]),
  );
  return observations.every(
    (observation) =>
      JSON.stringify(current.get(observation.sessionId)) ===
      JSON.stringify(observation),
  );
}
