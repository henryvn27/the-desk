import {
  planningPreferences,
  type PlanningPreferences,
  type Block,
  type Task,
} from "../domain/contracts";
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
/** Explicit capacity interval; callers supply local calendar/sleep boundaries as instants. */
export function plan(
  tasks: Task[],
  start: Date,
  end: Date,
  buffer = 0.15,
): {
  blocks: Block[];
  unscheduled: { taskId: string; minutes: number; reason: string }[];
  overloadMinutes: number;
} {
  if (
    !Number.isFinite(buffer) ||
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    end < start ||
    buffer < 0 ||
    buffer >= 1
  )
    throw Error("Invalid planning capacity");
  let remaining = Math.floor(((+end - +start) / 60000) * (1 - buffer));
  let cursor = +start;
  const blocks: Block[] = [];
  const unscheduled: { taskId: string; minutes: number; reason: string }[] = [];
  const pending = tasks
    .filter((t) => !t.completed)
    .sort(
      (a, b) =>
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
        why: task.dueAt
          ? `Earlier confirmed deadline; capacity includes a ${Math.round(buffer * 100)}% buffer.`
          : `Flexible work fits after confirmed deadlines; capacity includes a ${Math.round(buffer * 100)}% buffer.`,
      });
      cursor += minutes * 60000;
      remaining -= minutes;
    }
    const scheduled = blocks.at(-1)?.taskId === task.id ? minutes : 0;
    if (scheduled < task.minutes)
      unscheduled.push({
        taskId: task.id,
        minutes: task.minutes - scheduled,
        reason:
          deadline <= cursor
            ? "Cannot fit before its deadline."
            : "Not enough available time; required work remains.",
      });
  }
  return {
    blocks,
    unscheduled,
    overloadMinutes: unscheduled
      .filter((u) => tasks.find((t) => t.id === u.taskId)?.deadlineConfirmed)
      .reduce((sum, u) => sum + u.minutes, 0),
  };
}
