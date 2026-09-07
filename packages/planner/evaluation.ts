import type {
  Assessment,
  Block,
  Concept,
  Mistake,
  PlanningPreferences,
  Snapshot,
  StudyBlock,
  StudySession,
  Task,
} from "../domain/contracts";
import { chooseStableRepair, planWeek, type PlannerStrategy } from "./index";

export type PlannerScenarioFamily =
  | "ordinary-week"
  | "overloaded-week"
  | "exam-heavy-week"
  | "small-deadlines"
  | "large-project"
  | "schedule-disruption"
  | "chronic-underestimate"
  | "missed-day"
  | "variable-energy"
  | "uncertain-dates"
  | "cumulative-final"
  | "mixed-readiness";

export type PlannerScenario = {
  id: string;
  family: PlannerScenarioFamily;
  now: Date;
  preferences: PlanningPreferences;
  tasks: Task[];
  commitments?: StudyBlock[];
  grades?: Pick<Snapshot, "gradeCategories" | "gradeEntries"> & {
    mistakes?: Mistake[];
    concepts?: Concept[];
    assessments?: Assessment[];
    sessions?: StudySession[];
    attempts?: Snapshot["attempts"];
    teacherEvidence?: Snapshot["teacherEvidence"];
  };
  expected?: {
    lockedTaskId?: string;
    highImpactWeakTaskId?: string;
    uncertainTaskId?: string;
  };
};

export type PlannerScenarioScore = {
  id: string;
  family: PlannerScenarioFamily;
  feasible: boolean;
  deadlineSuccess: boolean;
  overloadTransparent: boolean;
  scheduleChurn: number;
  repairChurn: number;
  academicValue: number;
  bufferPreserved: boolean;
  planStable: boolean;
  userOverridesPreserved: boolean;
  explanationQuality: number;
  durationRealistic: boolean;
  assessmentSpacing: boolean;
  performancePatternUsed: boolean;
  blocks: number;
  unscheduledMinutes: number;
};

export type PlannerBenchmark = {
  scenarios: PlannerScenarioScore[];
  metrics: {
    feasibilityRate: number;
    deadlineSuccessRate: number;
    overloadTransparencyRate: number;
    meanScheduleChurn: number;
    meanRepairChurn: number;
    academicValueRate: number;
    bufferPreservationRate: number;
    planStabilityRate: number;
    overridePreservationRate: number;
    explanationQualityRate: number;
    durationRealismRate: number;
    assessmentSpacingRate: number;
    performancePatternRate: number;
  };
};

export type PlannerBenchmarkComparison = {
  before: PlannerBenchmark;
  after: PlannerBenchmark;
  delta: {
    feasibilityRate: number;
    deadlineSuccessRate: number;
    overloadTransparencyRate: number;
    meanScheduleChurn: number;
    meanRepairChurn: number;
    academicValueRate: number;
    bufferPreservationRate: number;
    planStabilityRate: number;
    overridePreservationRate: number;
    explanationQualityRate: number;
    durationRealismRate: number;
    assessmentSpacingRate: number;
    performancePatternRate: number;
  };
};

const iso = (value: string) => new Date(value);
const basePrefs: PlanningPreferences = {
  studyStart: "08:00",
  sleepCutoff: "22:00",
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  bufferPercent: 15,
};

function task(
  id: string,
  title: string,
  minutes: number,
  dueAt: string | null,
  options: Partial<Task> = {},
): Task {
  return {
    id,
    title,
    classId: options.classId ?? "class",
    minutes,
    dueAt,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: false,
    createdAt: "2026-09-06T08:00:00.000Z",
    revision: 0,
    ...options,
  };
}

function scenarioBase(
  id: string,
  family: PlannerScenarioFamily,
  tasks: Task[],
  overrides: Partial<PlannerScenario> = {},
): PlannerScenario {
  return {
    id,
    family,
    now: iso("2026-09-07T08:00:00.000Z"),
    preferences: basePrefs,
    tasks,
    ...overrides,
  };
}

function grades(
  partial: Partial<NonNullable<PlannerScenario["grades"]>> = {},
): NonNullable<PlannerScenario["grades"]> {
  return {
    gradeCategories: [],
    gradeEntries: [],
    ...partial,
  };
}

/** Fixed, realistic cases used for before/after planner comparison. */
export function plannerBenchmarkScenarios(): PlannerScenario[] {
  const ordinary = scenarioBase("ordinary-week", "ordinary-week", [
    task("reading", "Read biology chapter", 45, "2026-09-09T22:00:00.000Z"),
    task("problem-set", "Physics problem set", 70, "2026-09-10T22:00:00.000Z"),
    task("review", "Optional flashcard review", 30, null, { workKind: "optional-review" }),
  ]);
  const overloaded = scenarioBase("overloaded-week", "overloaded-week", [
    task("essay", "History essay", 240, "2026-09-08T22:00:00.000Z", { importance: "high" }),
    task("lab", "Physics lab analysis", 150, "2026-09-08T22:00:00.000Z"),
    task("quiz", "Chemistry quiz prep", 90, "2026-09-08T22:00:00.000Z", { workKind: "assessment" }),
  ], { preferences: { ...basePrefs, studyStart: "18:00", sleepCutoff: "21:00", studyDays: [1] } });
  const exam = scenarioBase("exam-heavy-week", "exam-heavy-week", [
    task("unit-review", "Calculus unit review", 180, "2026-09-10T18:00:00.000Z", { workKind: "assessment" }),
    task("chem-review", "Chemistry test preparation", 150, "2026-09-11T18:00:00.000Z", { workKind: "assessment" }),
    task("essay", "English reading response", 60, "2026-09-12T22:00:00.000Z"),
  ], {
    grades: grades({
      assessments: [
        {
          id: "calculus-test",
          classId: "class",
          title: "Calculus test",
          kind: "test",
          taskIds: ["unit-review"],
          dueAt: "2026-09-10T18:00:00.000Z",
          gradeCategoryId: null,
          notes: "",
          revision: 0,
          createdAt: "2026-09-06T08:00:00.000Z",
          updatedAt: "2026-09-06T08:00:00.000Z",
        },
        {
          id: "chem-test",
          classId: "class",
          title: "Chemistry test",
          kind: "test",
          taskIds: ["chem-review"],
          dueAt: "2026-09-11T18:00:00.000Z",
          gradeCategoryId: null,
          notes: "",
          revision: 0,
          createdAt: "2026-09-06T08:00:00.000Z",
          updatedAt: "2026-09-06T08:00:00.000Z",
        },
      ],
    }),
  });
  const small = scenarioBase("small-deadlines", "small-deadlines", [
    task("small-a", "Submit discussion post", 20, "2026-09-07T18:00:00.000Z"),
    task("small-b", "Finish vocabulary check", 20, "2026-09-07T20:00:00.000Z"),
    task("small-c", "Upload lab photo", 20, "2026-09-07T21:00:00.000Z"),
    task("small-d", "Start reading notes", 20, "2026-09-08T22:00:00.000Z"),
  ], { preferences: { ...basePrefs, studyStart: "17:00", sleepCutoff: "21:30", studyDays: [1, 2] } });
  const project = scenarioBase("large-project", "large-project", [
    task("capstone", "Research capstone", 420, "2026-09-13T22:00:00.000Z", { importance: "high" }),
    task("math", "Math homework", 45, "2026-09-09T22:00:00.000Z"),
  ], { preferences: { ...basePrefs, studyStart: "17:00", sleepCutoff: "21:00", studyDays: [1, 2, 3, 4, 5, 6, 0] } });
  const disruptionCommitment: StudyBlock = {
    id: "saved-block",
    taskId: "reading",
    start: "2026-09-08T18:00:00.000Z",
    end: "2026-09-08T19:00:00.000Z",
    minutes: 60,
    why: "User reserved study time",
    locked: true,
    revision: 2,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
  };
  const disruptionCommitments: StudyBlock[] = [disruptionCommitment, {
    id: "future-unlocked",
    taskId: "practice",
    start: "2026-09-09T18:00:00.000Z",
    end: "2026-09-09T19:00:00.000Z",
    minutes: 60,
    why: "Existing reservation",
    locked: false,
    revision: 1,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
  }];
  const disruption = scenarioBase("schedule-disruption", "schedule-disruption", [
    task("reading", "Read assigned chapter", 90, "2026-09-09T22:00:00.000Z"),
    task("practice", "Practice set", 90, "2026-09-10T22:00:00.000Z"),
  ], { commitments: disruptionCommitments, expected: { lockedTaskId: "reading" } });
  const durationHistory = [0, 1, 2].map((index) => task(
    `finished-${index}`,
    `Finished physics set ${index + 1}`,
    45,
    null,
    { classId: "physics", completed: true },
  ));
  const underestimate = scenarioBase("chronic-underestimate", "chronic-underestimate", [
    ...durationHistory,
    task("physics", "Physics problem set", 60, "2026-09-09T22:00:00.000Z", { classId: "physics" }),
    task("reading", "Physics reading", 45, "2026-09-10T22:00:00.000Z", { classId: "physics" }),
  ], {
    grades: grades({
      sessions: [0, 1, 2].map((index) => ({
        id: `duration-${index}`,
        taskId: `finished-${index}`,
        startedAt: "2026-09-01T18:00:00.000Z",
        pausedAt: null,
        pausedMs: 0,
        endedAt: "2026-09-01T20:00:00.000Z",
        actualMinutes: 90,
        completionReported: true,
        estimateAtStart: { minutes: 45, classId: "physics", workKind: "assignment", taskRevision: 0 },
        review: { reviewedAt: "2026-09-01T20:30:00.000Z", notes: "", remainingMinutes: null },
      })),
    }),
  });
  const missedDay = scenarioBase("missed-day", "missed-day", [
    task("carry", "Carry unfinished lab", 90, "2026-09-10T22:00:00.000Z"),
    task("new", "New assignment", 60, "2026-09-12T22:00:00.000Z", { importance: "high" }),
  ], { preferences: { ...basePrefs, studyStart: "18:00", sleepCutoff: "20:00", studyDays: [1, 2, 3, 4, 5] }, grades: grades({ sessions: [{ id: "missed", taskId: "carry", startedAt: "2026-09-06T18:00:00.000Z", pausedAt: null, pausedMs: 0, endedAt: "2026-09-06T18:30:00.000Z", actualMinutes: 30, completionReported: false }] }) });
  const energyHistory = [0, 1, 2, 3].map((index) => task(
    `math-history-${index}`,
    `Finished math set ${index + 1}`,
    60,
    null,
    { classId: "math", completed: true },
  ));
  const energy = scenarioBase("variable-energy", "variable-energy", [
    ...energyHistory,
    task("a-reading", "Late reading", 60, "2026-09-09T22:00:00.000Z", { classId: "english" }),
    task("z-math", "Heavy math practice", 90, "2026-09-09T22:00:00.000Z", { classId: "math" }),
  ], {
    grades: grades({
      sessions: [
        "2026-09-01T09:00:00.000Z",
        "2026-09-02T09:00:00.000Z",
        "2026-09-03T09:00:00.000Z",
        "2026-09-04T19:00:00.000Z",
      ].map((startedAt, index) => ({
        id: `energy-${index}`,
        taskId: `math-history-${index}`,
        startedAt,
        pausedAt: null,
        pausedMs: 0,
        endedAt: new Date(Date.parse(startedAt) + 60 * 60_000).toISOString(),
        actualMinutes: index === 3 ? 100 : 55,
        completionReported: true,
        estimateAtStart: { minutes: 60, classId: "math", workKind: "assignment", taskRevision: 0 },
        review: { reviewedAt: "2026-09-05T08:00:00.000Z", notes: "", remainingMinutes: null },
      })),
    }),
  });
  const uncertain = scenarioBase("uncertain-dates", "uncertain-dates", [
    task("uncertain", "Unconfirmed project", 120, "2026-09-09T22:00:00.000Z", { deadlineConfirmed: false }),
    task("confirmed", "Confirmed worksheet", 45, "2026-09-10T22:00:00.000Z"),
  ], { expected: { uncertainTaskId: "uncertain" } });
  const final = scenarioBase("cumulative-final", "cumulative-final", [
    task("final", "Cumulative final preparation", 360, "2026-09-14T18:00:00.000Z", { workKind: "assessment", importance: "high" }),
    task("daily", "Daily problem set", 60, "2026-09-08T22:00:00.000Z"),
  ], { grades: grades({ assessments: [{ id: "final-assessment", classId: "class", title: "Cumulative final", kind: "exam", taskIds: ["final"], dueAt: "2026-09-14T18:00:00.000Z", gradeCategoryId: null, notes: "", revision: 0, createdAt: "2026-09-06T08:00:00.000Z", updatedAt: "2026-09-06T08:00:00.000Z" }] }) });
  const mixedConcepts: Concept[] = [
    { id: "weak", classId: "class", taskIds: ["mixed"], name: "Weak prerequisite", status: "learning", preparedness: "not-ready", retentionMode: "course", reviewDue: null, attempts: 1, unaidedCorrect: 0, unaidedTotal: 1, hintCount: 0, lastReviewedAt: null, evidenceNote: "", revision: 0, createdAt: "2026-09-06T08:00:00.000Z", updatedAt: "2026-09-06T08:00:00.000Z" },
    { id: "strong", classId: "class", taskIds: ["mixed"], name: "Strong familiar concept", status: "strong", preparedness: "strong", retentionMode: "course", reviewDue: null, attempts: 5, unaidedCorrect: 5, unaidedTotal: 5, hintCount: 0, lastReviewedAt: "2026-09-06T08:00:00.000Z", evidenceNote: "", revision: 0, createdAt: "2026-09-06T08:00:00.000Z", updatedAt: "2026-09-06T08:00:00.000Z" },
  ];
  const mixed = scenarioBase("mixed-readiness", "mixed-readiness", [task("mixed", "Mixed concept assignment", 90, "2026-09-10T22:00:00.000Z")], { grades: grades({ concepts: mixedConcepts }) , expected: { highImpactWeakTaskId: "mixed" } });
  return [ordinary, overloaded, exam, small, project, disruption, underestimate, missedDay, energy, uncertain, final, mixed];
}

function rate(values: readonly boolean[]) {
  return values.length ? values.filter(Boolean).length / values.length : 0;
}

function deadlineSuccess(tasks: readonly Task[], blocks: readonly Block[], unscheduled: readonly { taskId: string; minutes: number }[]) {
  return tasks.filter((task) => !task.completed && task.deadlineConfirmed && task.dueAt).every((task) => {
    const required = blocks.filter((block) => block.taskId === task.id).reduce((sum, block) => sum + block.minutes, 0);
    const remaining = unscheduled.find((item) => item.taskId === task.id)?.minutes ?? 0;
    const latest = blocks.filter((block) => block.taskId === task.id).reduce((max, block) => Math.max(max, Date.parse(block.end)), 0);
    return required >= task.minutes && remaining === 0 && latest <= Date.parse(task.dueAt!);
  });
}

function explanationQuality(blocks: readonly Block[]) {
  if (!blocks.length) return 1;
  return blocks.reduce((score, block) => {
    let value = block.why.trim().length >= 40 ? 1 : 0;
    if (/deadline|assessment|concept|mistake|buffer|importance|session|grade/i.test(block.why)) value += 1;
    return score + value / 2;
  }, 0) / blocks.length;
}

function academicValue(scenario: PlannerScenario, blocks: readonly Block[]) {
  if (!blocks.length) return scenario.tasks.every((task) => task.workKind === "optional-review") ? 1 : 0;
  const first = blocks[0]!;
  const reasons = first.why;
  let score = /concept|mistake|assessment|importance|deadline/i.test(reasons) ? 0.5 : 0;
  if (scenario.expected?.highImpactWeakTaskId && first.taskId === scenario.expected.highImpactWeakTaskId) score += 0.5;
  if (scenario.family === "uncertain-dates" && !blocks.some((block) => block.taskId === scenario.expected?.uncertainTaskId)) score += 0.5;
  if (scenario.family === "exam-heavy-week" && blocks.some((block) => block.taskId === "unit-review")) score += 0.5;
  return Math.min(1, score);
}

function durationRealistic(scenario: PlannerScenario, result: ReturnType<typeof planWeek>) {
  const ranges = new Map(result.durationRanges.map((range) => [range.taskId, range]));
  const rangedTasks = scenario.tasks.filter((task) => ranges.has(task.id));
  if (!rangedTasks.length) return scenario.family !== "chronic-underestimate";
  return rangedTasks.every((task) =>
    result.blocks.filter((block) => block.taskId === task.id).reduce((sum, block) => sum + block.minutes, 0) >= ranges.get(task.id)!.upperMinutes,
  );
}

function assessmentSpacing(scenario: PlannerScenario, result: ReturnType<typeof planWeek>) {
  const assessmentTaskIds = new Set(
    (scenario.grades?.assessments ?? []).flatMap((assessment) => assessment.taskIds),
  );
  for (const task of scenario.tasks) {
    if (task.workKind === "assessment") assessmentTaskIds.add(task.id);
  }
  return [...assessmentTaskIds].some((taskId) =>
    new Set(result.blocks.filter((block) => block.taskId === taskId).map((block) => block.start.slice(0, 10))).size > 1,
  );
}

function performancePatternUsed(scenario: PlannerScenario, result: ReturnType<typeof planWeek>) {
  return scenario.family !== "variable-energy" || result.blocks[0]?.taskId === "z-math";
}

function scenarioScore(
  scenario: PlannerScenario,
  repeat: ReturnType<typeof planWeek>,
  second: ReturnType<typeof planWeek>,
  strategy: PlannerStrategy,
): PlannerScenarioScore {
  const blocks = repeat.blocks;
  const locked = scenario.commitments?.filter((block) => block.locked) ?? [];
  const userOverridesPreserved = locked.every((saved) =>
    repeat.blocks.every(
      (block) =>
        Date.parse(block.end) <= Date.parse(saved.start) ||
        Date.parse(block.start) >= Date.parse(saved.end),
    ),
  );
  const changedTaskIds = new Set(blocks.map((block) => block.taskId));
  const priorTaskIds = new Set((scenario.commitments ?? []).map((block) => block.taskId));
  const scheduleChurn = [...priorTaskIds].filter((taskId) => !changedTaskIds.has(taskId)).length + [...changedTaskIds].filter((taskId) => !priorTaskIds.has(taskId)).length;
  const futureUnlocked = (scenario.commitments ?? []).filter(
    (block) => !block.locked && Date.parse(block.start) > +scenario.now + 180_000,
  );
  let repairChurn = 0;
  if (futureUnlocked.length) {
    if (strategy === "v1") repairChurn = futureUnlocked.length;
    else {
      const kept = (scenario.commitments ?? []).filter((block) => !futureUnlocked.some((candidate) => candidate.id === block.id));
      const conservative = planWeek(scenario.tasks, new Date(+scenario.now + 180_000), scenario.preferences, scenario.commitments ?? [], scenario.grades, { strategy });
      const recalculated = planWeek(scenario.tasks, new Date(+scenario.now + 180_000), scenario.preferences, kept, scenario.grades, { strategy });
      repairChurn = chooseStableRepair(scenario.tasks, conservative, recalculated, futureUnlocked.length).useRecalculated ? futureUnlocked.length : 0;
    }
  }
  const bufferMinutes = Math.round((scenario.preferences.bufferPercent / 100) * 60 * scenario.preferences.studyDays.length);
  const occupiedMinutes = blocks.reduce((sum, block) => sum + block.minutes, 0);
  const nominalCapacity = scenario.preferences.studyDays.length * Math.max(0, (22 - 8) * 60 - bufferMinutes);
  return {
    id: scenario.id,
    family: scenario.family,
    feasible: repeat.unscheduled.filter((item) => scenario.tasks.find((task) => task.id === item.taskId)?.deadlineConfirmed).length === 0,
    deadlineSuccess: deadlineSuccess(scenario.tasks, blocks, repeat.unscheduled),
    overloadTransparent: repeat.overloadMinutes >= 0 && repeat.unscheduled.every((item) => item.reason.trim().length >= 20),
    scheduleChurn,
    academicValue: academicValue(scenario, blocks),
    repairChurn,
    bufferPreserved: occupiedMinutes <= nominalCapacity || repeat.overloadMinutes > 0,
    planStable: JSON.stringify(repeat.blocks) === JSON.stringify(second.blocks),
    userOverridesPreserved,
    explanationQuality: explanationQuality(blocks),
    durationRealistic: durationRealistic(scenario, repeat),
    assessmentSpacing: assessmentSpacing(scenario, repeat),
    performancePatternUsed: performancePatternUsed(scenario, repeat),
    blocks: blocks.length,
    unscheduledMinutes: repeat.unscheduled.reduce((sum, item) => sum + item.minutes, 0),
  };
}

export function benchmarkPlanner(
  scenarios = plannerBenchmarkScenarios(),
  strategy: PlannerStrategy = "adaptive",
): PlannerBenchmark {
  const scored = scenarios.map((scenario) => {
    const first = planWeek(scenario.tasks, scenario.now, scenario.preferences, scenario.commitments ?? [], scenario.grades, { strategy });
    const second = planWeek(scenario.tasks, scenario.now, scenario.preferences, scenario.commitments ?? [], scenario.grades, { strategy });
    return scenarioScore(scenario, first, second, strategy);
  });
  return {
    scenarios: scored,
    metrics: {
      feasibilityRate: rate(scored.map((item) => item.feasible)),
      deadlineSuccessRate: rate(scored.map((item) => item.deadlineSuccess)),
      overloadTransparencyRate: rate(scored.map((item) => item.overloadTransparent)),
      meanScheduleChurn: scored.reduce((sum, item) => sum + item.scheduleChurn, 0) / Math.max(1, scored.length),
      meanRepairChurn: scored.reduce((sum, item) => sum + item.repairChurn, 0) / Math.max(1, scored.length),
      academicValueRate: rate(scored.map((item) => item.academicValue >= 0.5)),
      bufferPreservationRate: rate(scored.map((item) => item.bufferPreserved)),
      planStabilityRate: rate(scored.map((item) => item.planStable)),
      overridePreservationRate: rate(scored.map((item) => item.userOverridesPreserved)),
      explanationQualityRate: scored.reduce((sum, item) => sum + item.explanationQuality, 0) / Math.max(1, scored.length),
      durationRealismRate: rate(scored.map((item) => item.durationRealistic)),
      assessmentSpacingRate: rate(scored.map((item) => item.assessmentSpacing)),
      performancePatternRate: rate(scored.map((item) => item.performancePatternUsed)),
    },
  };
}

export function comparePlannerBenchmarks(before: PlannerBenchmark, after: PlannerBenchmark): PlannerBenchmarkComparison {
  return {
    before,
    after,
    delta: {
      feasibilityRate: after.metrics.feasibilityRate - before.metrics.feasibilityRate,
      deadlineSuccessRate: after.metrics.deadlineSuccessRate - before.metrics.deadlineSuccessRate,
      overloadTransparencyRate: after.metrics.overloadTransparencyRate - before.metrics.overloadTransparencyRate,
      meanScheduleChurn: after.metrics.meanScheduleChurn - before.metrics.meanScheduleChurn,
      meanRepairChurn: after.metrics.meanRepairChurn - before.metrics.meanRepairChurn,
      academicValueRate: after.metrics.academicValueRate - before.metrics.academicValueRate,
      bufferPreservationRate: after.metrics.bufferPreservationRate - before.metrics.bufferPreservationRate,
      planStabilityRate: after.metrics.planStabilityRate - before.metrics.planStabilityRate,
      overridePreservationRate: after.metrics.overridePreservationRate - before.metrics.overridePreservationRate,
      explanationQualityRate: after.metrics.explanationQualityRate - before.metrics.explanationQualityRate,
      durationRealismRate: after.metrics.durationRealismRate - before.metrics.durationRealismRate,
      assessmentSpacingRate: after.metrics.assessmentSpacingRate - before.metrics.assessmentSpacingRate,
      performancePatternRate: after.metrics.performancePatternRate - before.metrics.performancePatternRate,
    },
  };
}
