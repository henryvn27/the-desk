import type { Snapshot } from "../domain/contracts";

/** Bounded, local evidence only. No URL fetching or inferred source authority. */
export function lensContext(state: Snapshot): string {
  const active = state.sessions.find((session) => !session.endedAt);
  const task = state.tasks.find((item) => item.id === active?.taskId);
  if (!task)
    return "No active academic session. Ask if academic context is unclear.";
  const eligible = state.sources
    .filter(
      (source) =>
        source.taskIds.includes(task.id) ||
        (source.taskIds.length === 0 && source.classIds.includes(task.classId)),
    )
    .sort(
      (a, b) =>
        Number(b.taskIds.includes(task.id)) -
          Number(a.taskIds.includes(task.id)) || a.id.localeCompare(b.id),
    );
  const context = {
    class: state.classes.find((course) => course.id === task.classId)?.name,
    task: task.title,
    notesExcerpt: task.notes.slice(0, 2000),
    notesTruncated: task.notes.length > 2000,
    resource: task.resource,
    resourceFetched: false,
    resourceOmitted: false,
    sources: [] as {
      id: string;
      title: string;
      authority: string;
      scope: string;
      excerpt: string;
      truncated: boolean;
    }[],
    omittedSources: eligible.length,
  };
  if (JSON.stringify(context).length > 20000) {
    context.notesExcerpt = "";
    context.notesTruncated = task.notes.length > 0;
    context.resource = null;
    context.resourceOmitted = task.resource !== null;
  }
  for (const source of eligible) {
    const entry = {
      id: source.id,
      title: source.title,
      authority: source.authority,
      scope: source.taskIds.includes(task.id) ? "task" : "class",
      excerpt: source.text.slice(0, 3000),
      truncated: source.text.length > 3000,
    };
    context.sources.push(entry);
    context.omittedSources--;
    if (JSON.stringify(context).length > 20000) {
      context.sources.pop();
      context.omittedSources++;
      break;
    }
  }
  return JSON.stringify(context);
}
