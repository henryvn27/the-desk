import { gradeInfluence } from "../grades";
import { createStudentModel } from "../intelligence/student-model";
import { durationRangeSuggestion, type DurationRangeSuggestion } from "../learning/duration";
import { derivePerformancePatterns, performanceFit, type PerformancePattern } from "../learning/performance";
import {
  planningPreferences,
  type PlanningPreferences,
  type Block,
  type Task,
  type StudyBlock,
  type Snapshot,
  type Mistake,
  type Concept,
  type Assessment,
  type StudySession,
} from "../domain/contracts";
export type GradeData = Pick<Snapshot, "gradeCategories" | "gradeEntries"> & {
  mistakes?: Mistake[];
  concepts?: Concept[];
  assessments?: Assessment[];
  sessions?: StudySession[];
  attempts?: Snapshot["attempts"];
  teacherEvidence?: Snapshot["teacherEvidence"];
  tasks?: Task[];
};
const noGrades: GradeData = { gradeCategories: [], gradeEntries: [] };
const optional = (t: Task) => t.workKind === "optional-review";
const importance = (t: Task) =>
  ({ low: 0, normal: 1, high: 2 })[t.importance ?? "normal"];
function priorityReason(t: Task) {
  return `${optional(t) ? "Optional review follows required work" : t.workKind === "assessment" ? "Assessment preparation" : "Required assignment"}; ${t.importance ?? "normal"} importance${t.dueAt ? "; confirmed deadline " + new Date(t.dueAt).toLocaleString() : "; flexible deadline"}.`;
}
function mistakePriority(task: Task, mistakes: Mistake[], horizon: number) {
  return mistakes.reduce((score, mistake) => {
    const due = mistake.reviewDue && Date.parse(mistake.reviewDue) <= horizon;
    const linked =
      mistake.taskId === task.id || mistake.practiceTaskIds.includes(task.id);
    if (linked) return Math.max(score, 3);
    if (mistake.classId === task.classId && due) return Math.max(score, 1);
    return score;
  }, 0);
}
function conceptPriority(
  task: Task,
  concepts: Concept[],
  horizon: number,
  model: ReturnType<typeof createStudentModel>,
) {
  return concepts.reduce((score, concept) => {
    const linked = concept.taskIds.includes(task.id);
    if (concept.classId !== task.classId) return score;
    const derived = model.getConceptState(concept.id);
    const review = model.getReviewDue(concept.id);
    const due =
      (review.dueAt && Date.parse(review.dueAt) <= horizon) ||
      concept.status === "review-due";
    const weak =
      derived?.preparedness === "not-ready" ||
      derived?.preparedness === "developing";
    const prerequisiteGap = Boolean(derived?.prerequisiteGaps.length);
    const objective = model.recommendLearningObjective({ taskId: task.id });
    const objectiveMatch = objective?.conceptId === concept.id;
    const priority = prerequisiteGap ? 4 : linked && (due || weak) ? 3 : linked ? 2 : due || weak ? 1 : 0;
    return Math.max(score, priority + (objectiveMatch ? 1 : 0));
  }, 0);
}
function assessmentPriority(
  task: Task,
  assessments: Assessment[],
  horizon: number,
) {
  return assessments.reduce((score, assessment) => {
    if (
      assessment.classId !== task.classId ||
      !assessment.taskIds.includes(task.id)
    )
      return score;
    if (assessment.dueAt && Date.parse(assessment.dueAt) <= horizon)
      return Math.max(score, 3);
    return Math.max(score, 2);
  }, 0);
}
function unfinishedSessionPriority(task: Task, sessions: StudySession[]) {
  return sessions.some(
    (session) =>
      session.taskId === task.id &&
      session.endedAt !== null &&
      session.completionReported === false,
  )
    ? 1
    : 0;
}

export type PlannedDurationRange = DurationRangeSuggestion & { taskId: string };
export type PlannerStrategy = "v1" | "adaptive";
export type PlannerOptions = { strategy?: PlannerStrategy };

export type RepairDecision = {
  useRecalculated: boolean;
  recoveredMinutes: number;
  reason: string;
};

function durationRanges(tasks: readonly Task[], grades: GradeData) {
  const historicalTasks = grades.tasks ?? tasks;
  const sessions = grades.sessions ?? [];
  return new Map(
    tasks.flatMap((task) => {
      const range = durationRangeSuggestion([...historicalTasks], sessions, task);
      return range ? [[task.id, range] as const] : [];
    }),
  );
}

function effectiveTasks(tasks: readonly Task[], ranges: Map<string, DurationRangeSuggestion>) {
  return tasks.map((task) => {
    const range = ranges.get(task.id);
    return range && range.upperMinutes > task.minutes
      ? { ...task, minutes: range.upperMinutes }
      : task;
  });
}

function assessmentCap(
  task: Task,
  assessments: readonly Assessment[],
  remaining: number,
  dayStart: Date,
  horizon: Date,
) {
  const linked = assessments.some(
    (assessment) =>
      assessment.classId === task.classId &&
      assessment.taskIds.includes(task.id),
  );
  if (!linked && task.workKind !== "assessment") return remaining;
  const due = task.dueAt ? Date.parse(task.dueAt) : +horizon;
  const planningEnd = Math.min(due, +horizon);
  const days = Math.max(1, Math.ceil((planningEnd - +dayStart) / 86_400_000));
  if (days <= 1 || remaining <= 45) return remaining;
  return Math.min(remaining, Math.max(30, Math.ceil(remaining / days / 5) * 5));
}

function durationWhy(range: DurationRangeSuggestion | undefined) {
  if (!range) return "";
  return ` Historical reviewed work suggests ${range.lowerMinutes}–${range.upperMinutes} minutes (likely ${range.likelyMinutes}); the upper end protects the plan from optimistic estimates.`;
}

function performanceWhy(task: Task, start: Date, patterns: readonly PerformancePattern[]) {
  const pattern = patterns.find(
    (candidate) =>
      candidate.classId === task.classId &&
      candidate.workKind === (task.workKind ?? "assignment"),
  );
  return pattern && performanceFit(task, start, patterns)
    ? ` Scheduled in the ${pattern.preferredBucket} window supported by ${pattern.samples} reviewed sessions.`
    : "";
}

function requiredUnscheduledMinutes(
  tasks: readonly Task[],
  result: ReturnType<typeof planWeek>,
) {
  return result.unscheduled.reduce((sum, item) => {
    const task = tasks.find((candidate) => candidate.id === item.taskId);
    return task && task.deadlineConfirmed && !optional(task) ? sum + item.minutes : sum;
  }, 0);
}

/**
 * Chooses between a conservative repair and a full recalculation. The
 * stability cost is paid only when a recalculation materially restores
 * deadline feasibility; otherwise the existing commitments stay in place.
 */
export function chooseStableRepair(
  tasks: readonly Task[],
  conservative: ReturnType<typeof planWeek>,
  recalculated: ReturnType<typeof planWeek>,
  replacedCount: number,
): RepairDecision {
  const conservativeMissing = requiredUnscheduledMinutes(tasks, conservative);
  const recalculatedMissing = requiredUnscheduledMinutes(tasks, recalculated);
  const recoveredMinutes = conservativeMissing - recalculatedMissing;
  const materialRecovery =
    recoveredMinutes >= Math.max(15, Math.ceil(Math.max(1, conservativeMissing) * 0.1));
  if (materialRecovery) {
    return {
      useRecalculated: true,
      recoveredMinutes,
      reason: `Released ${replacedCount} unlocked block${replacedCount === 1 ? "" : "s"} because the recalculation restores ${recoveredMinutes} required minutes before a deadline.`,
    };
  }
  return {
    useRecalculated: false,
    recoveredMinutes: Math.max(0, recoveredMinutes),
    reason: `Kept existing commitments because a full recalculation would not restore a material amount of required work; stability preserved.`,
  };
}
/** Local wall-clock boundaries use the OS timezone, including its DST rules. */
export function todayWindow(now: Date, raw: PlanningPreferences) {
  const prefs = planningPreferences.parse(raw);
  if (!Number.isFinite(+now)) throw Error("Invalid planning date");
  function at(time: string) {
    const date = new Date(now);
    const [hour, minute] = time.split(":").map(Number);
    date.setHours(hour!, minute!, 0, 0);
    return date;
  }
  const start = new Date(Math.max(+now, +at(prefs.studyStart)));
  const cutoff = at(prefs.sleepCutoff);
  const enabled = prefs.studyDays.includes(now.getDay());
  const end = new Date(enabled ? Math.max(+start, +cutoff) : +start);
  return { start, end, buffer: prefs.bufferPercent / 100 };
}
/** Seven local calendar days; each day's work consumes the task's remaining estimate once. */
export function planWeek(
  tasks: Task[],
  now: Date,
  preferences: PlanningPreferences,
  commitments: StudyBlock[] = [],
  grades: GradeData = noGrades,
  options: PlannerOptions = {},
) {
  const adaptive = options.strategy !== "v1";
  const residual = tasks.filter((t) => !t.completed).map((t) => ({ ...t }));
  const planningGrades: GradeData = adaptive
    ? { ...grades, tasks: grades.tasks ?? tasks }
    : grades;
  const ranges = adaptive ? durationRanges(residual, planningGrades) : new Map();
  const planningHorizon = new Date(+now + 7 * 86_400_000);
  // Elapsed blocks remain visible history; they are not evidence of completed work.
  const reserved = commitments.filter(
    (b) => !b.cancelledAt && Date.parse(b.end) > +now,
  );
  for (const task of residual) {
    task.minutes = Math.max(
      0,
      task.minutes -
        reserved
          .filter((b) => b.taskId === task.id)
          .reduce((sum, b) => sum + b.minutes, 0),
    );
  }
  const blocks: Block[] = [];
  let horizon = new Date(now);
  for (let day = 0; day < 7; day++) {
    const date = new Date(now);
    if (day) {
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + day);
    }
    const capacity = todayWindow(date, preferences);
    horizon = capacity.end;
    const occupied = reserved
      .filter(
        (b) =>
          Date.parse(b.start) < +capacity.end &&
          Date.parse(b.end) > +capacity.start,
      )
      .sort((a, b) => a.start.localeCompare(b.start));
    let cursor = +capacity.start;
    const gaps: [number, number][] = [];
    let occupiedMs = 0;
    for (const block of occupied) {
      const start = Math.max(+capacity.start, Date.parse(block.start));
      const end = Math.min(+capacity.end, Date.parse(block.end));
      if (start > cursor) gaps.push([cursor, start]);
      occupiedMs += Math.max(0, end - Math.max(cursor, start));
      cursor = Math.max(cursor, end);
    }
    if (cursor < +capacity.end) gaps.push([cursor, +capacity.end]);
    // Reserve the day's buffer once, including time already committed.
    let budget = Math.max(
      0,
      Math.floor(
        ((+capacity.end - +capacity.start) * (1 - capacity.buffer) -
          occupiedMs) /
          60000,
      ),
    );
    const allocatedAssessmentMinutes = new Map<string, number>();
    for (const [start, end] of gaps) {
      if (!budget) break;
      const dailyTasks = residual
        .filter((t) => t.minutes > 0)
        .map((task) => {
          if (!adaptive) return task;
          const range = ranges.get(task.id);
          const conservativeMinutes = Math.max(
            task.minutes,
            range?.upperMinutes ?? task.minutes,
          );
          const alreadyAllocated = allocatedAssessmentMinutes.get(task.id) ?? 0;
          const capped = assessmentCap(
            task,
            planningGrades.assessments ?? [],
            conservativeMinutes - alreadyAllocated,
            new Date(start),
            planningHorizon,
          );
          return { ...task, minutes: Math.max(0, capped) };
        })
        .filter((task) => task.minutes > 0);
      const daily = plan(
        dailyTasks,
        new Date(start),
        new Date(Math.min(end, start + budget * 60000)),
        0,
        capacity.end,
        planningGrades,
        {
          applyDurationRanges: false,
          applyPerformancePatterns: adaptive,
          appendAdaptiveWhy: adaptive,
        },
      );
      for (const block of daily.blocks) {
        blocks.push({
          ...block,
          why: `${block.why} Fits around saved blocks; daily capacity includes a ${preferences.bufferPercent}% buffer.`,
        });
        residual.find((t) => t.id === block.taskId)!.minutes -= block.minutes;
        if (adaptive)
          allocatedAssessmentMinutes.set(
            block.taskId,
            (allocatedAssessmentMinutes.get(block.taskId) ?? 0) + block.minutes,
          );
        budget -= block.minutes;
      }
    }
  }
  const unscheduled = residual
    .filter((t) => t.minutes > 0)
    .map((t) => ({
      taskId: t.id,
      minutes: t.minutes,
      reason: optional(t)
        ? "Optional review is deferred when required work or available time takes priority."
        : !t.deadlineConfirmed
          ? "Confirm the deadline before automatic scheduling."
          : t.dueAt && Date.parse(t.dueAt) <= +horizon
            ? "Cannot fit before its deadline within your available study time."
            : "Not scheduled in the next seven days; required work remains.",
    }));
  return {
    blocks,
    unscheduled,
    overloadMinutes: residual
      .filter((t) => t.deadlineConfirmed && !optional(t) && t.minutes > 0)
      .reduce((sum, t) => sum + t.minutes, 0),
    durationRanges: [...ranges.entries()].map(([taskId, range]) => ({ taskId, ...range })),
  };
}
/** Explicit capacity interval; callers supply local calendar/sleep boundaries as instants. */
export function plan(
  tasks: Task[],
  start: Date,
  end: Date,
  buffer = 0.15,
  urgencyEnd = end,
  grades: GradeData = noGrades,
  options: {
    applyDurationRanges?: boolean;
    applyPerformancePatterns?: boolean;
    appendAdaptiveWhy?: boolean;
  } = {},
): {
  blocks: Block[];
  unscheduled: { taskId: string; minutes: number; reason: string }[];
  overloadMinutes: number;
  durationRanges: PlannedDurationRange[];
} {
  if (
    !Number.isFinite(buffer) ||
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    !Number.isFinite(+urgencyEnd) ||
    end < start ||
    buffer < 0 ||
    buffer >= 1
  )
    throw Error("Invalid planning capacity");
  const ranges = options.applyDurationRanges === false ? new Map() : durationRanges(tasks, grades);
  const plannedTasks =
    options.applyDurationRanges === false ? tasks : effectiveTasks(tasks, ranges);
  const performancePatterns =
    options.applyPerformancePatterns === false
      ? []
      : derivePerformancePatterns(grades.tasks ?? tasks, grades.sessions ?? []);
  let remaining = Math.floor(((+end - +start) / 60000) * (1 - buffer));
  let cursor = +start;
  const blocks: Block[] = [];
  const unscheduled: { taskId: string; minutes: number; reason: string }[] = [];
  const influences = new Map(
    plannedTasks.map((t) => [t.id, gradeInfluence(t, grades)]),
  );
  const mistakes = grades.mistakes ?? [];
  const concepts = grades.concepts ?? [];
  const assessments = grades.assessments ?? [];
  const sessions = grades.sessions ?? [];
  const model = createStudentModel({
    concepts,
    attempts: grades.attempts ?? [],
    mistakes,
    sessions,
    assessments,
    teacherEvidence: grades.teacherEvidence ?? [],
    tasks: plannedTasks,
  }, start);
  const eligible = plannedTasks.filter(
    (t) => !t.completed && t.deadlineConfirmed && !optional(t),
  );
  const useGradeInfluence =
    eligible.length > 0 && eligible.every((t) => influences.get(t.id) !== null);
  const influenceScore = (t: Task) =>
    (influences.get(t.id)?.pointsPerTen ?? 0) /
    Math.max(1, t.dueAt ? (Date.parse(t.dueAt) - +start) / 86400000 : 7);
  const pending = plannedTasks
    .filter((t) => !t.completed)
    .sort(
      (a, b) =>
        conceptPriority(b, concepts, +urgencyEnd, model) -
          conceptPriority(a, concepts, +urgencyEnd, model) ||
        mistakePriority(b, mistakes, +urgencyEnd) -
          mistakePriority(a, mistakes, +urgencyEnd) ||
        assessmentPriority(b, assessments, +urgencyEnd) -
          assessmentPriority(a, assessments, +urgencyEnd) ||
        Number(optional(a)) - Number(optional(b)) ||
        Number(
          Boolean(
            b.deadlineConfirmed &&
            b.dueAt &&
            Date.parse(b.dueAt) <= +urgencyEnd,
          ),
        ) -
          Number(
            Boolean(
              a.deadlineConfirmed &&
              a.dueAt &&
              Date.parse(a.dueAt) <= +urgencyEnd,
            ),
          ) ||
        (a.deadlineConfirmed &&
        b.deadlineConfirmed &&
        a.dueAt &&
        b.dueAt &&
        Date.parse(a.dueAt) <= +urgencyEnd &&
        Date.parse(b.dueAt) <= +urgencyEnd
          ? Date.parse(a.dueAt) - Date.parse(b.dueAt)
          : 0) ||
        unfinishedSessionPriority(b, sessions) -
          unfinishedSessionPriority(a, sessions) ||
        (options.applyPerformancePatterns === false
          ? 0
          : Number(performanceFit(b, start, performancePatterns)) -
            Number(performanceFit(a, start, performancePatterns))) ||
        importance(b) - importance(a) ||
        (useGradeInfluence ? influenceScore(b) - influenceScore(a) : 0) ||
        Number(b.workKind === "assessment") -
          Number(a.workKind === "assessment") ||
        (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
          (b.dueAt ? Date.parse(b.dueAt) : Infinity) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  for (const task of pending) {
    if (!task.deadlineConfirmed) {
      unscheduled.push({
        taskId: task.id,
        minutes: task.minutes,
        reason: "Confirm the deadline before automatic scheduling.",
      });
      continue;
    }
    const deadline = task.dueAt ? Date.parse(task.dueAt) : +end;
    const available = Math.max(
      0,
      Math.min(remaining, Math.floor((deadline - cursor) / 60000)),
    );
    const minutes = Math.min(task.minutes, available);
    if (minutes >= Math.min(task.minutes, 15)) {
      blocks.push({
        taskId: task.id,
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + minutes * 60000).toISOString(),
        minutes,
        why: `${conceptPriority(task, concepts, +urgencyEnd, model) > 0 ? "Prioritized because a linked concept needs review; the Student Model supplied the reason. " : ""}${mistakePriority(task, mistakes, +urgencyEnd) > 0 ? "Prioritized because a linked or due mistake needs review. " : ""}${assessmentPriority(task, assessments, +urgencyEnd) > 0 ? `Prioritized because it is linked to an upcoming assessment${options.appendAdaptiveWhy === false ? "." : "; preparation is distributed across available days."} ` : ""}${unfinishedSessionPriority(task, sessions) > 0 ? "Continued from an unfinished study session. " : ""}${priorityReason(task)}${options.appendAdaptiveWhy === false ? "" : `${durationWhy(ranges.get(task.id))}${performanceWhy(task, start, performancePatterns)}`} ${influences.get(task.id) ? `In the recorded ${influences.get(task.id)!.category} model, a 10-percentage-point score change on this item shifts the course model by ${influences.get(task.id)!.pointsPerTen.toFixed(2)} percentage points; this is potential influence, not predicted improvement. ` : ""}${useGradeInfluence ? "After imminent deadlines and your importance choice, potential influence is divided by days until due (minimum one; flexible work uses seven). " : "Incomplete grade context: using deadline and importance ordering. "}`,
      });
      cursor += minutes * 60000;
      remaining -= minutes;
    }
    const scheduled = blocks.at(-1)?.taskId === task.id ? minutes : 0;
    if (scheduled < task.minutes)
      unscheduled.push({
        taskId: task.id,
        minutes: task.minutes - scheduled,
        reason: optional(task)
          ? "Optional review is deferred when required work or available time takes priority."
          : deadline <= cursor
            ? "Cannot fit before its deadline."
            : "Not enough available time; required work remains.",
      });
  }
  return {
    blocks,
    unscheduled,
    overloadMinutes: unscheduled
      .filter((u) => {
        const t = plannedTasks.find((t) => t.id === u.taskId);
        return t?.deadlineConfirmed && !optional(t);
      })
      .reduce((sum, u) => sum + u.minutes, 0),
    durationRanges: [...ranges.entries()].map(([taskId, range]) => ({ taskId, ...range })),
  };
}
