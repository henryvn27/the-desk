import { gradeInfluence } from "../grades";
import {
  planningPreferences,
  type PlanningPreferences,
  type Block,
  type Task,
  type StudyBlock,
  type Snapshot,
  type Mistake,
} from "../domain/contracts";
type GradeData = Pick<Snapshot, "gradeCategories" | "gradeEntries"> & {
  mistakes?: Mistake[];
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
) {
  const residual = tasks.filter((t) => !t.completed).map((t) => ({ ...t }));
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
    for (const [start, end] of gaps) {
      if (!budget) break;
      const daily = plan(
        residual.filter((t) => t.minutes > 0),
        new Date(start),
        new Date(Math.min(end, start + budget * 60000)),
        0,
        capacity.end,
        grades,
      );
      for (const block of daily.blocks) {
        blocks.push({
          ...block,
          why: `${block.why} Fits around saved blocks; daily capacity includes a ${preferences.bufferPercent}% buffer.`,
        });
        residual.find((t) => t.id === block.taskId)!.minutes -= block.minutes;
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
): {
  blocks: Block[];
  unscheduled: { taskId: string; minutes: number; reason: string }[];
  overloadMinutes: number;
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
  let remaining = Math.floor(((+end - +start) / 60000) * (1 - buffer));
  let cursor = +start;
  const blocks: Block[] = [];
  const unscheduled: { taskId: string; minutes: number; reason: string }[] = [];
  const influences = new Map(
    tasks.map((t) => [t.id, gradeInfluence(t, grades)]),
  );
  const mistakes = grades.mistakes ?? [];
  const eligible = tasks.filter(
    (t) => !t.completed && t.deadlineConfirmed && !optional(t),
  );
  const useGradeInfluence =
    eligible.length > 0 && eligible.every((t) => influences.get(t.id) !== null);
  const influenceScore = (t: Task) =>
    (influences.get(t.id)?.pointsPerTen ?? 0) /
    Math.max(1, t.dueAt ? (Date.parse(t.dueAt) - +start) / 86400000 : 7);
  const pending = tasks
    .filter((t) => !t.completed)
    .sort(
      (a, b) =>
        mistakePriority(b, mistakes, +urgencyEnd) -
          mistakePriority(a, mistakes, +urgencyEnd) ||
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
        why: `${mistakePriority(task, mistakes, +urgencyEnd) > 0 ? "Prioritized because a linked or due mistake needs review. " : ""}${priorityReason(task)} ${influences.get(task.id) ? `In the recorded ${influences.get(task.id)!.category} model, a 10-percentage-point score change on this item shifts the course model by ${influences.get(task.id)!.pointsPerTen.toFixed(2)} percentage points; this is potential influence, not predicted improvement. ` : ""}${useGradeInfluence ? "After imminent deadlines and your importance choice, potential influence is divided by days until due (minimum one; flexible work uses seven). " : "Incomplete grade context: using deadline and importance ordering. "}`,
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
        const t = tasks.find((t) => t.id === u.taskId);
        return t?.deadlineConfirmed && !optional(t);
      })
      .reduce((sum, u) => sum + u.minutes, 0),
  };
}
