import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { planWeek, todayWindow } from "../packages/planner/index.ts";
import { deriveHome } from "../packages/planner/home.ts";

const prefs = {
  studyStart: "08:00",
  sleepCutoff: "22:00",
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  bufferPercent: 15,
};
const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const task = (key, title, dueAt, options = {}) => ({
  id: id(key),
  title,
  classId: id(100),
  minutes: options.minutes ?? 45,
  dueAt,
  resource: null,
  notes: "",
  deadlineConfirmed: options.deadlineConfirmed ?? true,
  completed: options.completed ?? false,
  createdAt: "2026-09-01T08:00:00.000Z",
  revision: 0,
  ...options,
});
const base = (tasks, extra = {}) => ({
  tasks,
  planning: prefs,
  studyBlocks: [],
  sessions: [],
  authorityClaims: [],
  authorityResolutions: [],
  syncConflicts: [],
  planChanges: [],
  assessments: [],
  canvases: [],
  sources: [],
  classes: [],
  ...extra,
});

const cases = [
  { id: "normal-school-day", now: "2026-09-07T09:00:00.000Z", state: base([task(1, "Calculus problem set", "2026-09-08T22:00:00.000Z"), task(2, "Physics reading", "2026-09-10T22:00:00.000Z")]) },
  { id: "weekend", now: "2026-09-12T10:00:00.000Z", state: base([task(3, "Monday worksheet", "2026-09-14T22:00:00.000Z")], { planning: { ...prefs, studyDays: [1, 2, 3, 4, 5] } }) },
  { id: "overloaded-day", now: "2026-09-07T18:00:00.000Z", state: base([task(4, "History essay", "2026-09-08T22:00:00.000Z", { minutes: 500 }), task(5, "Physics lab", "2026-09-08T22:00:00.000Z", { minutes: 500 })], { planning: { ...prefs, studyStart: "18:00", sleepCutoff: "19:00", studyDays: [1] } }) },
  { id: "exam-tomorrow", now: "2026-09-07T18:00:00.000Z", state: base([task(6, "Calculus exam preparation", "2026-09-08T12:00:00.000Z", { workKind: "assessment", importance: "high", minutes: 120 })], { assessments: [{ id: id(61), classId: id(100), title: "Calculus exam", kind: "exam", taskIds: [id(6)], dueAt: "2026-09-08T12:00:00.000Z", gradeCategoryId: null, notes: "", revision: 0, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" }] }) },
  { id: "nothing-due", now: "2026-09-07T09:00:00.000Z", state: base([]) },
  { id: "missed-session", now: "2026-09-07T09:00:00.000Z", state: base([task(7, "Review vectors", "2026-09-09T22:00:00.000Z")], { sessions: [{ id: id(71), taskId: id(7), startedAt: "2026-09-06T18:00:00.000Z", pausedAt: null, pausedMs: 0, endedAt: "2026-09-06T18:30:00.000Z", actualMinutes: 30, completionReported: false }] }) },
  { id: "uncertain-deadline", now: "2026-09-07T09:00:00.000Z", state: base([task(8, "Unconfirmed project", "2026-09-10T22:00:00.000Z", { deadlineConfirmed: false })]) },
  { id: "plan-just-changed", now: "2026-09-07T12:00:00.000Z", state: base([task(9, "Physics", "2026-09-09T22:00:00.000Z")], { planChanges: [{ id: id(91), createdAt: "2026-09-07T08:00:00.000Z", appliedAt: "2026-09-07T08:00:00.000Z", expiresAt: "2026-09-07T08:02:00.000Z", replaced: [{ id: id(92), taskId: id(9), start: "2026-09-07T10:00:00.000Z", end: "2026-09-07T10:45:00.000Z", minutes: 45, why: "", locked: false, revision: 0, createdAt: "2026-09-07T08:00:00.000Z", updatedAt: "2026-09-07T08:00:00.000Z" }], added: [{ id: id(93), taskId: id(9), start: "2026-09-07T10:20:00.000Z", end: "2026-09-07T11:05:00.000Z", minutes: 45, why: "", locked: false, revision: 0, createdAt: "2026-09-07T08:00:00.000Z", updatedAt: "2026-09-07T08:00:00.000Z" }], kept: [], unscheduled: [] }] }) },
  { id: "active-study-session", now: "2026-09-07T09:00:00.000Z", state: base([task(10, "Active physics session", "2026-09-08T22:00:00.000Z")], { sessions: [{ id: id(101), taskId: id(10), startedAt: "2026-09-07T08:30:00.000Z", pausedAt: null, pausedMs: 0, endedAt: null, actualMinutes: null }] }) },
  { id: "offline", now: "2026-09-07T09:00:00.000Z", state: base([task(11, "Offline reading", "2026-09-08T22:00:00.000Z")]) },
];

function before(state, now) {
  const capacity = todayWindow(now, state.planning);
  const plan = planWeek(state.tasks, now, state.planning, state.studyBlocks, state);
  const schedule = [...plan.blocks, ...state.studyBlocks]
    .filter((block) => Date.parse(block.end) > +now && Date.parse(block.start) < +capacity.end)
    .sort((a, b) => a.start.localeCompare(b.start));
  return {
    next: state.tasks.find((candidate) => candidate.id === schedule[0]?.taskId)?.title ?? null,
    nextReason: schedule[0]?.why ?? null,
    todayCount: schedule.slice(1).length,
    attentionCount: plan.unscheduled.length,
    upcomingCount: 0,
    continueCount: 0,
  };
}

const rows = cases.map(({ id: caseId, now: rawNow, state }) => {
  const now = new Date(rawNow);
  const old = before(state, now);
  const next = deriveHome(state, now);
  return {
    id: caseId,
    before: old,
    after: {
      next: state.tasks.find((candidate) => candidate.id === next.next?.taskId)?.title ?? null,
      nextReason: next.next?.why ?? null,
      todayCount: next.today.length,
      attention: next.attention.map((item) => item.kind),
      upcoming: next.upcoming.map((item) => item.title),
      continue: next.continue.map((item) => item.kind),
      planChange: next.planChange?.text ?? null,
    },
  };
});
const output = resolve("artifacts/home/benchmark-latest.json");
await mkdir(resolve("artifacts/home"), { recursive: true });
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);
const weekend = rows.find((row) => row.id === "weekend");
if (!weekend?.after.next) throw Error("Home benchmark expected a weekend next recommendation.");
console.log(JSON.stringify({ result: "PASS", output, rows }, null, 2));
