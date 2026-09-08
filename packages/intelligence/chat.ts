import { z } from "zod";
import type { Snapshot } from "../domain/contracts";
import { deriveHome, type HomeProjection } from "../planner/home";
import { packAvailableTime, type AvailableTimePlan } from "./learning-loop";
import type { DeskIntelligence } from "./desk-intelligence";
import {
  calendarDayDistance,
  formatInstant,
  resolveTimeZone,
  zonedDate,
} from "../domain/time-zone";

const historyTurn = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const chatRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(4_000),
    history: z.array(historyTurn).max(8).optional(),
    sourceIds: z.array(z.string().uuid()).max(100).optional(),
    context: z
      .object({
        page: z.string().trim().max(100).optional(),
        classId: z.string().uuid().optional(),
        taskId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ChatAction =
  | { type: "start-session"; taskId: string }
  | { type: "resume-session" }
  | { type: "open-page"; page: "Home" | "Plan" | "Notes" | "Library" | "Capture" }
  | { type: "open-notes"; taskId: string };

export type ChatUpcomingItem = {
  taskId: string;
  title: string;
  className: string;
  dueAt: string;
  kind: "assessment" | "deadline";
};

export type ChatArtifact =
  | {
      kind: "next";
      title: string;
      detail: string;
      className?: string;
      estimatedMinutes?: number;
      taskId?: string;
      action?: ChatAction;
    }
  | {
      kind: "continue";
      title: string;
      detail: string;
      taskId: string;
      action: ChatAction;
    }
  | { kind: "upcoming"; items: ChatUpcomingItem[]; timeZone?: string }
  | { kind: "attention"; items: Array<{ title: string; detail: string; taskId?: string }> }
  | {
      kind: "time-plan";
      availableMinutes: number;
      blocks: AvailableTimePlan["blocks"];
      explanation: string;
    };

export type ChatResponse = {
  kind: "deterministic" | "assistant" | "unavailable";
  text: string;
  deterministic: boolean;
  artifact?: ChatArtifact;
  action?: ChatAction;
  suggestions?: string[];
  model?: string;
};

function className(snapshot: Snapshot, classId: string | undefined) {
  return classId ? snapshot.classes.find((course) => course.id === classId)?.name : undefined;
}

function taskFor(snapshot: Snapshot, taskId: string | undefined) {
  return taskId ? snapshot.tasks.find((task) => task.id === taskId) : undefined;
}

function profileTimeZone(snapshot: Snapshot) {
  return resolveTimeZone(snapshot.user?.timeZone);
}

function nextResponse(snapshot: Snapshot, intelligence: DeskIntelligence, home: HomeProjection): ChatResponse {
  const nextAction = intelligence.nextAction;
  const task = taskFor(snapshot, nextAction.taskId);
  const course = className(snapshot, nextAction.classId ?? task?.classId);
  const action = nextAction.kind === "active-session"
    ? ({ type: "resume-session" } satisfies ChatAction)
    : nextAction.taskId
      ? ({ type: "start-session", taskId: nextAction.taskId } satisfies ChatAction)
      : undefined;
  const artifact: ChatArtifact = {
    kind: "next",
    title: nextAction.title,
    detail: nextAction.reason,
    ...(course ? { className: course } : {}),
    ...(nextAction.estimatedMinutes ? { estimatedMinutes: nextAction.estimatedMinutes } : {}),
    ...(nextAction.taskId ? { taskId: nextAction.taskId } : {}),
    ...(action ? { action } : {}),
  };
  const prefix = nextAction.kind === "active-session" ? "You’re already in motion." : "Your next move is clear.";
  const scheduleHint = home.next && nextAction.kind === "start-task" ? ` It’s a ${home.next.minutes}-minute Planner block.` : "";
  return {
    kind: "deterministic",
    deterministic: true,
    text: `${prefix} ${nextAction.title}.${scheduleHint} ${nextAction.reason}`,
    artifact,
    ...(action ? { action } : {}),
  };
}

function upcomingResponse(snapshot: Snapshot, home: HomeProjection): ChatResponse {
  const items = home.upcoming.map((item) => ({
    taskId: item.taskId,
    title: item.title,
    className: className(snapshot, item.classId) ?? "Unassigned class",
    dueAt: item.dueAt,
    kind: item.kind,
  }));
  if (!items.length)
    return {
      kind: "deterministic",
      deterministic: true,
      text: "Nothing currently curated for attention is coming up in the next two weeks.",
      suggestions: ["What should I do now?", "I have 25 minutes"],
    };
  return {
    kind: "deterministic",
    deterministic: true,
    text: `Here are the next ${items.length} confirmed deadlines.`,
    artifact: { kind: "upcoming", items, timeZone: profileTimeZone(snapshot) },
  };
}


/** Literal confirmed deadlines in the next seven local calendar days. */
export function deadlinePeriodItems(snapshot: Snapshot, now: Date, days = 7) {
  const timeZone = profileTimeZone(snapshot);
  const start = zonedDate(now, timeZone);
  const assessmentByTask = new Map<string, string>();
  for (const assessment of snapshot.assessments) {
    for (const taskId of assessment.taskIds) assessmentByTask.set(taskId, assessment.title);
  }
  const items = snapshot.tasks
    .filter((task) => {
      if (task.completed || !task.deadlineConfirmed || !task.dueAt) return false;
      const due = new Date(task.dueAt);
      if (!Number.isFinite(+due) || +due <= +now) return false;
      const dayOffset = calendarDayDistance(start, zonedDate(due, timeZone));
      return dayOffset >= 0 && dayOffset <= days;
    })
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!) || a.title.localeCompare(b.title))
    .slice(0, 10)
    .map((task) => ({
      taskId: task.id,
      title: assessmentByTask.get(task.id) ?? task.title,
      className: className(snapshot, task.classId) ?? "Unassigned class",
      dueAt: task.dueAt!,
      kind: task.workKind === "assessment" || assessmentByTask.has(task.id) ? "assessment" as const : "deadline" as const,
    }));
  return { items, timeZone };
}

function deadlinePeriodResponse(snapshot: Snapshot, now: Date): ChatResponse {
  const { items, timeZone } = deadlinePeriodItems(snapshot, now);
  if (!items.length)
    return {
      kind: "deterministic",
      deterministic: true,
      text: "There are no confirmed deadlines in the next seven days.",
      suggestions: ["What should I do now?", "I have 25 minutes"],
    };
  return {
    kind: "deterministic",
    deterministic: true,
    text: `Here are the confirmed deadlines in the next seven days (${timeZone}).`,
    artifact: { kind: "upcoming", items, timeZone },
  };
}

function attentionResponse(home: HomeProjection): ChatResponse {
  const items = home.attention.map((item) => ({
    title: item.title,
    detail: item.detail,
    ...(item.taskId ? { taskId: item.taskId } : {}),
  }));
  if (!items.length)
    return {
      kind: "deterministic",
      deterministic: true,
      text: "Nothing currently requires a decision. Your local plan and saved work are in a good state.",
    };
  return {
    kind: "deterministic",
    deterministic: true,
    text: "These are the items that actually need a decision or repair.",
    artifact: { kind: "attention", items },
  };
}

function continueResponse(snapshot: Snapshot, home: HomeProjection): ChatResponse {
  const item = home.continue[0];
  if (!item)
    return {
      kind: "deterministic",
      deterministic: true,
      text: "There isn’t an unfinished Note, assignment checklist, or study session to resume yet.",
      suggestions: ["What should I do now?", "Capture something"],
    };
  const action: ChatAction = item.kind === "note"
    ? { type: "open-notes", taskId: item.taskId }
    : { type: "start-session", taskId: item.taskId };
  return {
    kind: "deterministic",
    deterministic: true,
    text: `Continue ${item.title}. ${item.detail}.`,
    artifact: { kind: "continue", title: item.title, detail: item.detail, taskId: item.taskId, action },
    action,
  };
}

function timeResponse(snapshot: Snapshot, rawMinutes: number, now: Date): ChatResponse {
  const plan = packAvailableTime(snapshot, rawMinutes, now);
  return {
    kind: "deterministic",
    deterministic: true,
    text: plan.blocks.length
      ? `For ${plan.availableMinutes} minutes, ${plan.explanation}`
      : plan.explanation,
    artifact: {
      kind: "time-plan",
      availableMinutes: plan.availableMinutes,
      blocks: plan.blocks,
      explanation: plan.explanation,
    },
  };
}

function directTaskStart(snapshot: Snapshot, question: string): ChatResponse | null {
  const match = question.match(/^(?:start|begin|work on|do)\s+(.+)$/i);
  if (!match?.[1]) return null;
  const query = match[1].trim().toLocaleLowerCase();
  const matches = snapshot.tasks.filter((task) => !task.completed && task.title.toLocaleLowerCase().includes(query));
  if (matches.length !== 1)
    return matches.length > 1
      ? { kind: "deterministic", deterministic: true, text: "I found more than one open task with that name. Tell me the class or use the exact title." }
      : { kind: "deterministic", deterministic: true, text: "I couldn’t find one uncompleted task with that title. Check the spelling or ask what’s next." };
  const task = matches[0]!;
  return {
    kind: "deterministic",
    deterministic: true,
    text: `Ready to start ${task.title}.`,
    action: { type: "start-session", taskId: task.id },
    artifact: {
      kind: "next",
      title: task.title,
      detail: "This is an explicit request to start the matching open task.",
      ...(className(snapshot, task.classId) ? { className: className(snapshot, task.classId) } : {}),
      estimatedMinutes: task.minutes,
      taskId: task.id,
      action: { type: "start-session", taskId: task.id },
    },
  };
}

/** Context-aware chips shown before the student types. This is a projection, not saved academic state. */
export function deriveChatSuggestions(snapshot: Snapshot, intelligence: DeskIntelligence, now = new Date()) {
  const home = deriveHome(snapshot, now);
  const suggestions: string[] = [];
  const active = snapshot.sessions.find((session) => !session.endedAt);
  const task = taskFor(snapshot, active?.taskId);
  if (active && task) suggestions.push(`Continue ${task.title}`);
  else if (intelligence.nextAction.kind === "start-task") suggestions.push(`Start ${intelligence.nextAction.title}`);
  if (home.attention.length) suggestions.push("What needs my attention?");
  if (deadlinePeriodItems(snapshot, now).items.length) suggestions.push("What’s due this week?");
  if (!suggestions.length) suggestions.push("What should I do now?");
  suggestions.push("I have 25 minutes");
  return [...new Set(suggestions)].slice(0, 4);
}

/** Resolve only bounded, deterministic requests. A null result may be sent to the trusted provider boundary. */
export function resolveChat(
  snapshot: Snapshot,
  intelligence: DeskIntelligence,
  request: ChatRequest,
  now = new Date(),
): ChatResponse | null {
  const question = request.question.trim();
  const normalized = question.toLocaleLowerCase();
  const home = deriveHome(snapshot, now);
  const active = snapshot.sessions.find((session) => !session.endedAt);
  const activeTask = taskFor(snapshot, active?.taskId);

  const direct = directTaskStart(snapshot, question);
  if (direct) return direct;
  if (/\b(?:what should i do|what do i do|what now|next move|next action|what(?:'|’)?s next|where do i start|start me)\b/.test(normalized))
    return nextResponse(snapshot, intelligence, home);
  if (/\b(?:continue|resume|where i left|pick up|unfinished)\b/.test(normalized))
    return continueResponse(snapshot, home);
  if (/\bupcoming\b/.test(normalized))
    return upcomingResponse(snapshot, home);
  if (/\b(?:due|deadline|deadlines|this week)\b/.test(normalized))
    return deadlinePeriodResponse(snapshot, now);
  if (/\b(?:attention|urgent|conflict|problem|needs? a decision|overloaded)\b/.test(normalized))
    return attentionResponse(home);
  if (/\b(?:why|explain this|why this)\b/.test(normalized)) {
    const action = intelligence.nextAction;
    return {
      kind: "deterministic",
      deterministic: true,
      text: `${action.title} is recommended because ${action.reason} ${action.evidence.slice(0, 2).join(" ")}`,
      artifact: {
        kind: "next",
        title: action.title,
        detail: action.reason,
        ...(action.taskId ? { taskId: action.taskId } : {}),
      },
    };
  }
  const minutes = normalized.match(/\b(?:have|got|for)\s+(\d{1,3})\s*(?:m|min|mins|minute|minutes)\b/);
  if (minutes?.[1]) return timeResponse(snapshot, Number(minutes[1]), now);
  if (/\b(?:capture|save this|remember this)\b/.test(normalized))
    return { kind: "deterministic", deterministic: true, text: "I can save this to Capture Inbox first, then finish filing it in the background.", action: { type: "open-page", page: "Capture" } };
  if (/\b(?:open|show|go to)\s+(?:my\s+)?notes?\b/.test(normalized))
    return activeTask
      ? { kind: "deterministic", deterministic: true, text: `Open Notes for ${activeTask.title}.`, action: { type: "open-notes", taskId: activeTask.id } }
      : { kind: "deterministic", deterministic: true, text: "Open Notes from the workspace rail.", action: { type: "open-page", page: "Notes" } };
  if (/\b(?:open|show|go to)\s+(?:the\s+)?(?:plan|planner|schedule)\b/.test(normalized))
    return { kind: "deterministic", deterministic: true, text: "Open the canonical Planner view.", action: { type: "open-page", page: "Plan" } };
  if (/\b(?:open|show|go to)\s+(?:the\s+)?(?:library|sources?)\b/.test(normalized))
    return { kind: "deterministic", deterministic: true, text: "Open Library for source search and exact evidence.", action: { type: "open-page", page: "Library" } };
  return null;
}

/** Bounded grounding for provider-backed explanations. Canonical records remain authoritative. */
export function chatGrounding(snapshot: Snapshot, intelligence: DeskIntelligence, request: ChatRequest, now = new Date()) {
  const home = deriveHome(snapshot, now);
  const active = snapshot.sessions.find((session) => !session.endedAt);
  const task = taskFor(snapshot, active?.taskId);
  const payload = {
    purpose: "Desk chat grounding; canonical local projections only",
    now: now.toISOString(),
    classContext: request.context?.classId ? className(snapshot, request.context.classId) : undefined,
    activeSession: task ? { taskId: task.id, title: task.title, className: className(snapshot, task.classId) } : null,
    nextAction: intelligence.nextAction,
    nextBestAction: {
      title: intelligence.nextBestAction.title,
      reason: intelligence.nextBestAction.reason.primary,
      taskId: intelligence.nextBestAction.taskId,
      classId: intelligence.nextBestAction.classId,
      concepts: intelligence.nextBestAction.conceptIds,
    },
    attention: home.attention.slice(0, 6),
    upcoming: home.upcoming.slice(0, 5).map((item) => ({ ...item, className: className(snapshot, item.classId) })),
    continue: home.continue.slice(0, 5),
    classes: snapshot.classes.slice(0, 20).map((course) => ({ id: course.id, name: course.name })),
    openTasks: snapshot.tasks.filter((candidate) => !candidate.completed).slice(0, 20).map((candidate) => ({ id: candidate.id, title: candidate.title, classId: candidate.classId, dueAt: candidate.dueAt, minutes: candidate.minutes })),
    limitations: intelligence.limitations,
  };
  return JSON.stringify(payload).slice(0, 14_000);
}

export function formatUpcoming(item: ChatUpcomingItem, timeZone?: string | null) {
  return `${item.title} · ${item.className} · ${formatInstant(item.dueAt, timeZone)}`;
}
