import type { PlanningPreferences, StudyBlock, Task } from "../domain/contracts";
import {
  planWeek,
  type GradeData,
  type PlannerOptions,
} from "./index";

export type PlannerWhatIfChange =
  | { kind: "skip-date"; date: string }
  | { kind: "add-minutes"; taskId: string; minutes: number }
  | { kind: "move-deadline"; taskId: string; dueAt: string | null }
  | { kind: "stop-at"; time: string };

export type PlannerWhatIfInput = {
  tasks: Task[];
  now: Date;
  preferences: PlanningPreferences;
  commitments?: StudyBlock[];
  grades?: GradeData;
  options?: PlannerOptions;
};

export type PlannerWhatIfResult = {
  baseline: ReturnType<typeof planWeek>;
  scenario: ReturnType<typeof planWeek>;
  change: PlannerWhatIfChange;
  impact: {
    unscheduledMinutesDelta: number;
    deadlineRisk: "unchanged" | "increased" | "reduced";
    movedTaskCount: number;
    explanation: string;
  };
};

function validDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw Error("What-if dates must be valid ISO dates.");
  return date;
}

function requiredMinutes(result: ReturnType<typeof planWeek>, tasks: readonly Task[]) {
  return result.unscheduled.reduce((sum, item) => {
    const task = tasks.find((candidate) => candidate.id === item.taskId);
    return task && task.deadlineConfirmed && task.workKind !== "optional-review" ? sum + item.minutes : sum;
  }, 0);
}

function movedTasks(
  before: ReturnType<typeof planWeek>,
  after: ReturnType<typeof planWeek>,
) {
  const starts = new Map<string, string>();
  for (const block of before.blocks) starts.set(block.taskId, block.start);
  return new Set(
    after.blocks
      .filter((block) => starts.get(block.taskId) !== block.start)
      .map((block) => block.taskId),
  ).size;
}

/** Runs a deterministic plan repair without persisting the hypothetical change. */
export function evaluatePlannerWhatIf(
  input: PlannerWhatIfInput,
  change: PlannerWhatIfChange,
): PlannerWhatIfResult {
  const baseline = planWeek(
    input.tasks,
    input.now,
    input.preferences,
    input.commitments ?? [],
    input.grades,
    input.options,
  );
  const tasks = input.tasks.map((task) => ({ ...task }));
  let preferences = { ...input.preferences };
  if (change.kind === "skip-date") {
    const date = validDate(change.date);
    preferences = {
      ...preferences,
      studyDays: preferences.studyDays.filter((day) => day !== date.getDay()),
    };
  } else if (change.kind === "add-minutes") {
    if (!Number.isFinite(change.minutes) || change.minutes <= 0)
      throw Error("Additional planning time must be positive.");
    const task = tasks.find((candidate) => candidate.id === change.taskId);
    if (!task) throw Error("Choose an assignment for the what-if scenario.");
    task.minutes = Math.min(2400, task.minutes + Math.round(change.minutes));
  } else if (change.kind === "move-deadline") {
    const task = tasks.find((candidate) => candidate.id === change.taskId);
    if (!task) throw Error("Choose an assignment for the what-if scenario.");
    if (change.dueAt !== null) validDate(change.dueAt);
    task.dueAt = change.dueAt;
    task.deadlineConfirmed = change.dueAt !== null;
  } else {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(change.time))
      throw Error("Stop time must use HH:MM.");
    if (change.time <= preferences.studyStart)
      throw Error("Stop time must be after the study start.");
    preferences = { ...preferences, sleepCutoff: change.time };
  }
  const scenario = planWeek(
    tasks,
    input.now,
    preferences,
    input.commitments ?? [],
    input.grades,
    input.options,
  );
  const baselineMissing = requiredMinutes(baseline, input.tasks);
  const scenarioMissing = requiredMinutes(scenario, tasks);
  const deadlineRisk = scenarioMissing === baselineMissing
    ? "unchanged"
    : scenarioMissing > baselineMissing
      ? "increased"
      : "reduced";
  return {
    baseline,
    scenario,
    change,
    impact: {
      unscheduledMinutesDelta: scenarioMissing - baselineMissing,
      deadlineRisk,
      movedTaskCount: movedTasks(baseline, scenario),
      explanation: scenarioMissing === baselineMissing
        ? "The change fits without increasing required work left unscheduled."
        : scenarioMissing > baselineMissing
          ? `${scenarioMissing - baselineMissing} additional required minutes no longer fit; review the repaired plan before committing it.`
          : `${baselineMissing - scenarioMissing} required minutes are recovered by the repaired plan.`,
    },
  };
}
