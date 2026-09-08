import type {
  AuthorityClaim,
  Block,
  PlanChange,
  Snapshot,
  StudyBlock,
} from "../domain/contracts";
import { planWeek, todayWindow } from "./index";

export type HomeBlock = Block & {
  id?: string;
  locked?: boolean;
  origin?: StudyBlock["origin"];
};

export type HomeAttentionKind =
  | "conflict"
  | "overdue"
  | "decision"
  | "overload"
  | "session-review"
  | "integration";

export type HomeAttention = {
  id: string;
  kind: HomeAttentionKind;
  taskId?: string;
  title: string;
  detail: string;
};

export type HomeUpcoming = {
  id: string;
  taskId: string;
  title: string;
  classId: string;
  dueAt: string;
  kind: "assessment" | "deadline";
};

export type HomeContinueKind = "note" | "session" | "assignment";

export type HomeContinue = {
  id: string;
  kind: HomeContinueKind;
  taskId: string;
  title: string;
  detail: string;
  canvasId?: string;
  blockId?: string;
  updatedAt?: string;
};

export type HomePlanChange = {
  id: string;
  text: string;
  appliedAt: string;
};

export type HomeProjection = {
  plan: ReturnType<typeof planWeek>;
  schedule: HomeBlock[];
  next?: HomeBlock;
  today: HomeBlock[];
  attention: HomeAttention[];
  upcoming: HomeUpcoming[];
  continue: HomeContinue[];
  planChange?: HomePlanChange;
};

function blockKey(block: Pick<Block, "taskId" | "start" | "end">) {
  return `${block.taskId}:${block.start}:${block.end}`;
}

function taskFor(snapshot: Snapshot, taskId: string | null | undefined) {
  return taskId ? snapshot.tasks.find((task) => task.id === taskId) : undefined;
}

function liveBlocks(snapshot: Snapshot, now: Date, plan: ReturnType<typeof planWeek>) {
  const committed: HomeBlock[] = snapshot.studyBlocks
    .filter((block) => {
      const task = taskFor(snapshot, block.taskId);
      return (
        !block.cancelledAt &&
        Date.parse(block.end) > +now &&
        Boolean(task && !task.completed)
      );
    })
    .map((block) => ({
      taskId: block.taskId,
      start: block.start,
      end: block.end,
      minutes: block.minutes,
      why: block.why,
      id: block.id,
      locked: block.locked,
      origin: block.origin,
    }));
  const calculated: HomeBlock[] = plan.blocks
    .filter((block) => {
      const task = taskFor(snapshot, block.taskId);
      return Boolean(task && !task.completed && Date.parse(block.end) > +now);
    })
    .map((block) => ({ ...block }));
  const seen = new Set<string>();
  return [...committed, ...calculated]
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))
    .filter((block) => {
      const key = blockKey(block);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function unresolvedClaimForTask(snapshot: Snapshot, taskId: string) {
  return snapshot.authorityClaims.find(
    (claim) =>
      claim.taskId === taskId &&
      !snapshot.authorityResolutions.some(
        (resolution) =>
          resolution.taskId === claim.taskId &&
          resolution.fact === claim.fact &&
          resolution.claimId === claim.id,
      ),
  );
}

function claimDetail(claim: AuthorityClaim) {
  const value = claim.value ? new Date(claim.value).toLocaleString() : "no date";
  return `${claim.sourceLabel} says ${value}. Choose which deadline to keep.`;
}

function attentionItems(snapshot: Snapshot, now: Date, plan: ReturnType<typeof planWeek>) {
  const items: HomeAttention[] = [];
  const active = snapshot.sessions.some((session) => !session.endedAt);
  const unresolvedSync = snapshot.syncConflicts.filter(
    (conflict) => conflict.resolution === "unresolved",
  );
  if (unresolvedSync.length) {
    items.push({
      id: "sync-conflicts",
      kind: "integration",
      title: "Cloud sync needs a decision",
      detail: `${unresolvedSync.length} local change${unresolvedSync.length === 1 ? "" : "s"} need review. Your local work remains saved on this Mac.`,
    });
  }
  for (const task of snapshot.tasks) {
    if (task.completed) continue;
    const claim = unresolvedClaimForTask(snapshot, task.id);
    if (claim) {
      items.push({
        id: `conflict:${task.id}`,
        kind: "conflict",
        taskId: task.id,
        title: task.title,
        detail: claimDetail(claim),
      });
      continue;
    }
    if (task.dueAt && task.deadlineConfirmed && Date.parse(task.dueAt) < +now) {
      items.push({
        id: `overdue:${task.id}`,
        kind: "overdue",
        taskId: task.id,
        title: task.title,
        detail: `Due ${new Date(task.dueAt).toLocaleString()}. Decide whether to finish it now or repair the plan.`,
      });
      continue;
    }
    if (!task.deadlineConfirmed) {
      items.push({
        id: `decision:${task.id}`,
        kind: "decision",
        taskId: task.id,
        title: task.title,
        detail: "The deadline is still uncertain. Confirm it before Desk schedules this work automatically.",
      });
    }
  }
  if (!active) {
    const review = [...snapshot.sessions]
      .reverse()
      .find(
        (session) =>
          session.endedAt &&
          session.completionReported === false &&
          !session.review,
      );
    const task = review ? taskFor(snapshot, review.taskId) : undefined;
    if (review && task) {
      items.push({
        id: `session-review:${review.id}`,
        kind: "session-review",
        taskId: task.id,
        title: `Review ${task.title}`,
        detail: "This study session ended unfinished. Record what remains before relying on the next plan.",
      });
    }
  }
  const requiredUnscheduled = plan.unscheduled.filter((item) => {
    const task = taskFor(snapshot, item.taskId);
    return Boolean(task && task.deadlineConfirmed && task.workKind !== "optional-review");
  });
  if (requiredUnscheduled.length) {
    const minutes = requiredUnscheduled.reduce((sum, item) => sum + item.minutes, 0);
    items.push({
      id: "plan-overload",
      kind: "overload",
      title: "The plan needs repair",
      detail: `${minutes} minutes of required work do not fit before the current planning horizon. Review the proposed repair before commitments move.`,
    });
  }
  const priority: Record<HomeAttentionKind, number> = {
    conflict: 0,
    overdue: 1,
    decision: 2,
    "session-review": 3,
    overload: 4,
    integration: 5,
  };
  return items
    .sort((a, b) => priority[a.kind] - priority[b.kind] || a.title.localeCompare(b.title))
    .slice(0, 6);
}

function upcomingItems(snapshot: Snapshot, now: Date, todayEnd: Date): HomeUpcoming[] {
  const assessmentByTask = new Map<string, string>();
  for (const assessment of snapshot.assessments) {
    for (const taskId of assessment.taskIds) assessmentByTask.set(taskId, assessment.title);
  }
  const weekLimit = +now + 7 * 86_400_000;
  const importantLimit = +now + 14 * 86_400_000;
  return snapshot.tasks
    .filter((task) => {
      if (task.completed || !task.deadlineConfirmed || !task.dueAt) return false;
      const due = Date.parse(task.dueAt);
      if (due <= +todayEnd) return false;
      const important = task.workKind === "assessment" || task.importance === "high" || assessmentByTask.has(task.id);
      const soon = due <= +todayEnd + 3 * 86_400_000;
      const majorDeadline = task.minutes >= 90;
      return due <= (important ? importantLimit : weekLimit) && (important || (soon && majorDeadline));
    })
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.title.localeCompare(b.title))
    .slice(0, 5)
    .map((task) => ({
      id: `upcoming:${task.id}`,
      taskId: task.id,
      title: assessmentByTask.get(task.id) ?? task.title,
      classId: task.classId,
      dueAt: task.dueAt!,
      kind: task.workKind === "assessment" || assessmentByTask.has(task.id) ? "assessment" : "deadline",
    }));
}

function continueItems(snapshot: Snapshot, now: Date): HomeContinue[] {
  const result: HomeContinue[] = [];
  const activeIds = new Set(snapshot.sessions.filter((session) => !session.endedAt).map((session) => session.taskId));
  for (const session of [...snapshot.sessions]
    .filter((candidate) => candidate.endedAt && !activeIds.has(candidate.taskId))
    .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))) {
    const task = taskFor(snapshot, session.taskId);
    if (!task || task.completed || session.completionReported !== false) continue;
    result.push({
      id: `session:${session.id}`,
      kind: "session",
      taskId: task.id,
      title: task.title,
      detail: "Unfinished study session",
      updatedAt: session.endedAt ?? undefined,
    });
  }
  const noteRefs = new Map<string, { canvasId: string; blockId: string; sourceTitle?: string }>();
  for (const source of snapshot.sources) {
    for (const annotation of source.annotations ?? []) {
      for (const ref of annotation.noteRefs) {
        if (!noteRefs.has(ref.canvasId)) noteRefs.set(ref.canvasId, { ...ref, sourceTitle: source.title });
      }
    }
  }
  for (const canvas of [...snapshot.canvases]
    .filter((candidate) => Date.parse(candidate.updatedAt) <= +now + 60_000)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))) {
    const task = taskFor(snapshot, canvas.taskId);
    if (!task || activeIds.has(task.id)) continue;
    const ref = noteRefs.get(canvas.id);
    result.push({
      id: `note:${canvas.id}`,
      kind: "note",
      taskId: task.id,
      title: canvas.title,
      detail: ref?.sourceTitle ? `Continue at the passage from ${ref.sourceTitle}` : "Recently edited Note",
      canvasId: canvas.id,
      blockId: ref?.blockId,
      updatedAt: canvas.updatedAt,
    });
  }
  for (const task of snapshot.tasks
    .filter((candidate) => !candidate.completed && candidate.checklist?.some((item) => !item.archived && !item.completed))
    .sort((a, b) => (Date.parse(a.dueAt ?? "9999-12-31") - Date.parse(b.dueAt ?? "9999-12-31")))) {
    if (result.some((item) => item.taskId === task.id)) continue;
    result.push({
      id: `assignment:${task.id}`,
      kind: "assignment",
      taskId: task.id,
      title: task.title,
      detail: "Continue the assignment checklist",
    });
  }
  return result.slice(0, 5);
}

function planChangeSummary(snapshot: Snapshot, change: PlanChange, now: Date): HomePlanChange | undefined {
  const applied = Date.parse(change.appliedAt);
  if (!Number.isFinite(applied) || applied > +now || +now - applied > 48 * 60 * 60_000) return undefined;
  const replaced = change.replaced.filter((block) => !block.locked);
  const added = change.added;
  if (!replaced.length && !added.length) return undefined;
  const title = (taskId: string) => taskFor(snapshot, taskId)?.title ?? "Study block";
  const moved = replaced
    .map((oldBlock) => {
      const replacement = added.find((candidate) => candidate.taskId === oldBlock.taskId);
      if (!replacement) return undefined;
      const delta = Math.round((Date.parse(replacement.start) - Date.parse(oldBlock.start)) / 60_000);
      return Math.abs(delta) >= 10 ? { title: title(oldBlock.taskId), delta } : undefined;
    })
    .find(Boolean);
  let text: string;
  if (moved) {
    text = `${moved.title} moved ${Math.abs(moved.delta)} minutes ${moved.delta >= 0 ? "later" : "earlier"}.`;
  } else if (replaced.length && added.length) {
    const released = title(replaced[0]!.taskId);
    const firstAdded = title(added[0]!.taskId);
    text = `${firstAdded} moved after ${released} changed.`;
  } else if (added.length) {
    text = `${title(added[0]!.taskId)} was added to the plan.`;
  } else {
    text = `${title(replaced[0]!.taskId)} was removed from a future block.`;
  }
  return { id: change.id, text, appliedAt: change.appliedAt };
}

export function deriveHome(snapshot: Snapshot, now = new Date()): HomeProjection {
  const plan = planWeek(snapshot.tasks, now, snapshot.planning, snapshot.studyBlocks, snapshot);
  const schedule = liveBlocks(snapshot, now, plan);
  const todayEnd = todayWindow(now, snapshot.planning).end;
  const today = schedule.filter((block) => Date.parse(block.start) < +todayEnd && Date.parse(block.end) > +now);
  const next = schedule[0];
  const nextKey = next ? blockKey(next) : "";
  return {
    plan,
    schedule,
    next,
    today: today.filter((block) => blockKey(block) !== nextKey),
    attention: attentionItems(snapshot, now, plan),
    upcoming: upcomingItems(snapshot, now, todayEnd),
    continue: continueItems(snapshot, now),
    planChange: [...snapshot.planChanges]
      .sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt))
      .map((change) => planChangeSummary(snapshot, change, now))
      .find((change): change is HomePlanChange => Boolean(change)),
  };
}
