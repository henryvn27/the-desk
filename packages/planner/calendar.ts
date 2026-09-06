import type { Class, StudyBlock, Task } from "../domain/contracts";

function escapeText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r?\n/g, "\\n");
}

function utcStamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(+date)) throw Error("Calendar export contains an invalid date.");
  return date.toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Build a standards-shaped iCalendar file from explicitly saved Desk blocks.
 * This is a user-started file export: it never publishes to a remote calendar
 * and intentionally excludes cancelled reservations.
 */
export function studyBlocksToIcs(
  blocks: readonly StudyBlock[],
  tasks: readonly Task[],
  classes: readonly Class[],
): string {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const classById = new Map(classes.map((course) => [course.id, course]));
  const events = blocks
    .filter((block) => !block.cancelledAt)
    .map((block) => {
      const task = taskById.get(block.taskId);
      if (!task) return null;
      const start = utcStamp(block.start);
      const end = utcStamp(block.end);
      const course = classById.get(task.classId);
      const summary = course ? `${task.title} · ${course.name}` : task.title;
      const details = [block.why, task.notes].filter(Boolean).join("\n\n");
      const uid = `${block.id}@thedesk.local`;
      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${utcStamp(block.updatedAt)}`,
        `DTSTART:${start}`,
        `DTEND:${end}`,
        `SUMMARY:${escapeText(summary)}`,
        ...(details ? [`DESCRIPTION:${escapeText(details)}`] : []),
        `X-THE-DESK-TASK-ID:${block.taskId}`,
        `X-THE-DESK-BLOCK-ID:${block.id}`,
        ...(task.resource ? [`URL:${escapeText(task.resource)}`] : []),
        "END:VEVENT",
      ].join("\r\n");
    })
    .filter((event): event is string => event !== null);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Desk//Study Plan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
