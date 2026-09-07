import { inferenceEvidenceCurrent } from "../learning/memory";
import { sourcePassage } from "./passages";
import { sourcePriority } from "./source-kind";
import { authorityClaimsConflict, authorityPriority } from "./authority";
import type { Snapshot } from "../domain/contracts";

/** Bounded, local evidence only. No URL fetching or inferred source authority. */
export function lensContext(
  state: Snapshot,
  question = "",
  sourceIds?: string[],
): string {
  const active = state.sessions.find((session) => !session.endedAt);
  const task = state.tasks.find((item) => item.id === active?.taskId);
  const requested = sourceIds?.length ? new Set(sourceIds) : undefined;
  if (!task && !requested)
    return "No active academic session. Ask if academic context is unclear.";
  const eligible = state.sources
    .filter(
      (source) =>
        requested
          ? requested.has(source.id)
          : Boolean(
              task &&
                (source.taskIds.includes(task.id) ||
                  (source.taskIds.length === 0 && source.classIds.includes(task.classId))),
            ),
    )
    .map((source) => ({
      ...source,
      passage: sourcePassage(source.text, question),
    }))
    .sort(
      (a, b) =>
        sourcePriority(a.kind) - sourcePriority(b.kind) ||
        b.passage.matchedQueryTerms - a.passage.matchedQueryTerms ||
        Number(Boolean(task && b.taskIds.includes(task.id))) -
          Number(Boolean(task && a.taskIds.includes(task.id))) ||
        a.id.localeCompare(b.id),
    );
  const authorityClaims = (state.authorityClaims ?? [])
    .filter((claim) => task && claim.taskId === task.id)
    .sort(
      (a, b) =>
        authorityPriority(a.authorityKind) -
          authorityPriority(b.authorityKind) ||
        b.capturedAt.localeCompare(a.capturedAt) ||
        a.id.localeCompare(b.id),
    );
  const authorityResolution = task
    ? (state.authorityResolutions ?? []).find(
        (resolution) =>
          resolution.taskId === task.id && resolution.fact === "due-date",
      )
    : undefined;
  const selectedClassId = task?.classId ?? eligible.flatMap((source) => source.classIds)[0];
  const context = {
    scope: requested ? "selected-sources" : "active-task",
    selectedSourceIds: requested ? [...requested] : undefined,
    class: state.classes.find((course) => course.id === selectedClassId)?.name,
    task: task?.title ?? "Selected Library sources",
    notesExcerpt: task?.notes.slice(0, 2000) ?? "",
    notesTruncated: (task?.notes.length ?? 0) > 2000,
    resource: task?.resource ?? null,
    resourceFetched: false,
    resourceOmitted: false,
    memories: [] as {
      id: string;
      text: string;
      category: string;
      origin: "explicit" | "inferred";
    }[],
    omittedMemories: 0,
    authorityClaims: [] as Array<{
      id: string;
      fact: string;
      value: string | null;
      authorityKind: string;
      confidence: string;
      sourceLabel: string;
      details: string;
      capturedAt: string;
      resolved: boolean;
    }>,
    omittedAuthorityClaims: authorityClaims.length,
    authorityConflict: authorityClaimsConflict(authorityClaims),
    authorityResolution: authorityResolution
      ? {
          claimId: authorityResolution.claimId,
          resolvedAt: authorityResolution.resolvedAt,
        }
      : null,
    sources: [] as (ReturnType<typeof sourcePassage> & {
      id: string;
      title: string;
      authority: string;
      kind: string;
      kindReportedBy: "user";
      scope: string;
      excerpt: string;
      truncated: boolean;
    })[],
    omittedSources: eligible.length,
  };
  if (JSON.stringify(context).length > 20000) {
    context.notesExcerpt = "";
    context.notesTruncated = (task?.notes.length ?? 0) > 0;
    context.resource = null;
    context.resourceOmitted = task?.resource !== null && task?.resource !== undefined;
  }
  const memories = (state.memories ?? []).filter(
    (memory) =>
      (!memory.classId || memory.classId === selectedClassId) &&
      (memory.origin === "explicit" ||
        (state.inference?.enabled && inferenceEvidenceCurrent(memory, state))),
  );
  context.omittedMemories = memories.length;
  for (const memory of memories) {
    const entry = {
      id: memory.id,
      text: memory.text,
      category: memory.category,
      origin: memory.origin,
    };
    context.memories.push(entry);
    context.omittedMemories--;
    // Reserve the majority of the request for original source passages.
    if (
      JSON.stringify(context.memories).length > 4000 ||
      JSON.stringify(context).length > 20000
    ) {
      context.memories.pop();
      context.omittedMemories++;
      break;
    }
  }
  for (const claim of authorityClaims) {
    const entry = {
      id: claim.id,
      fact: claim.fact,
      value: claim.value,
      authorityKind: claim.authorityKind,
      confidence: claim.confidence,
      sourceLabel: claim.sourceLabel,
      details: claim.details.slice(0, 1200),
      capturedAt: claim.capturedAt,
      resolved: authorityResolution?.claimId === claim.id,
    };
    context.authorityClaims.push(entry);
    context.omittedAuthorityClaims--;
    if (JSON.stringify(context).length > 20000) {
      context.authorityClaims.pop();
      context.omittedAuthorityClaims++;
      break;
    }
  }
  for (const source of eligible) {
    const entry = {
      id: source.id,
      title: source.title,
      authority: source.authority,
      kind: source.kind ?? "unspecified",
      kindReportedBy: "user" as const,
      scope: task && source.taskIds.includes(task.id) ? "task" : requested ? "selected" : "class",
      ...source.passage,
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
