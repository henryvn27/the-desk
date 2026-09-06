import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task, Source, StudySession } from "../domain/contracts";
import { sessionKit } from "./kit";
const task: Task = {
  id: "task",
  classId: "physics",
  title: "Vectors",
  minutes: 30,
  dueAt: null,
  deadlineConfirmed: true,
  notes: "",
  resource: null,
  completed: false,
  createdAt: "2026-09-05T12:00:00Z",
};
test("session kit keeps explicit task sources separate from general class notes", () => {
  const sources: Source[] = [
    { id: "linked", taskIds: [task.id], classIds: [task.classId] },
    { id: "class", taskIds: [], classIds: [task.classId] },
    { id: "other-task", taskIds: ["other"], classIds: [task.classId] },
    { id: "other-class", taskIds: [], classIds: ["other"] },
  ].map((source) => ({
    ...source,
    title: source.id,
    text: "Saved text",
    createdAt: task.createdAt,
    authority: "user-provided-text",
  }));
  const kit = sessionKit(task, { sources, sessions: [] });
  assert.deepEqual(
    kit.linkedSources.map((s) => s.id),
    ["linked"],
  );
  assert.deepEqual(
    kit.classSources.map((s) => s.id),
    ["class"],
  );
  assert.deepEqual(kit.previousReviews, []);
});
test("session kit selects the latest three nonblank ended reviews for this task", () => {
  const sessions: StudySession[] = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    taskId: i === 6 ? "other" : task.id,
    startedAt: task.createdAt,
    endedAt: i === 5 ? null : task.createdAt,
    actualMinutes: 20,
    pausedAt: null,
    pausedMs: 0,
    review: {
      reviewedAt: task.createdAt,
      notes: i === 4 ? "  " : `Review ${i}`,
      remainingMinutes: null,
    },
  }));
  assert.deepEqual(
    sessionKit(task, { sources: [], sessions }).previousReviews.map(
      (s) => s.id,
    ),
    ["3", "2", "1"],
  );
  assert.equal(sessions.length, 7);
});
