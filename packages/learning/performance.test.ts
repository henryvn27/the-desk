import { test } from "node:test";
import assert from "node:assert/strict";
import type { StudySession, Task } from "../domain/contracts";
import { derivePerformancePatterns, performanceFit } from "./performance";

const tasks: Task[] = [
  {
    id: "math-1",
    title: "Math one",
    classId: "math",
    minutes: 60,
    dueAt: null,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: true,
    createdAt: "2026-09-01T08:00:00.000Z",
    revision: 0,
  },
  {
    id: "math-2",
    title: "Math two",
    classId: "math",
    minutes: 60,
    dueAt: null,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: true,
    createdAt: "2026-09-02T08:00:00.000Z",
    revision: 0,
  },
  {
    id: "math-3",
    title: "Math three",
    classId: "math",
    minutes: 60,
    dueAt: null,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: true,
    createdAt: "2026-09-03T08:00:00.000Z",
    revision: 0,
  },
  {
    id: "math-4",
    title: "Math four",
    classId: "math",
    minutes: 60,
    dueAt: null,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: true,
    createdAt: "2026-09-04T08:00:00.000Z",
    revision: 0,
  },
];

const sessions: StudySession[] = [
  "2026-09-01T09:00:00.000Z",
  "2026-09-02T09:00:00.000Z",
  "2026-09-03T09:00:00.000Z",
  "2026-09-04T19:00:00.000Z",
].map((startedAt, index) => ({
  id: `session-${index}`,
  taskId: tasks[index]!.id,
  startedAt,
  pausedAt: null,
  pausedMs: 0,
  endedAt: new Date(Date.parse(startedAt) + 45 * 60_000).toISOString(),
  actualMinutes: index === 3 ? 100 : 45,
  completionReported: true,
  estimateAtStart: {
    minutes: 60,
    classId: "math",
    workKind: "assignment",
    taskRevision: 0,
  },
  review: { reviewedAt: "2026-09-05T08:00:00.000Z", notes: "", remainingMinutes: null },
}));

test("performance patterns require repeated reviewed evidence and stay explainable", () => {
  const patterns = derivePerformancePatterns(tasks, sessions);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0]?.preferredBucket, "morning");
  assert.match(patterns[0]?.explanation ?? "", /reviewed/);
  assert.equal(performanceFit(tasks[0]!, new Date("2026-09-08T09:00:00.000Z"), patterns), true);
  assert.equal(performanceFit(tasks[0]!, new Date("2026-09-08T19:00:00.000Z"), patterns), false);
});

test("a single time-of-day observation cannot create a planning pattern", () => {
  assert.deepEqual(derivePerformancePatterns(tasks.slice(0, 2), sessions.slice(0, 2)), []);
});
