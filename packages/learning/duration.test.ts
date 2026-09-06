import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task, StudySession } from "../domain/contracts";
import { durationSuggestion } from "./duration";

function fixture() {
  const tasks: Task[] = [20, 40, 600].map((_, i) => ({
    id: String(i),
    classId: "physics",
    title: "Problems",
    minutes: 20,
    dueAt: null,
    resource: null,
    notes: "",
    deadlineConfirmed: true,
    completed: true,
    createdAt: "2026-09-05T10:00:00Z",
    revision: 0,
  }));
  const sessions: StudySession[] = [20, 40, 600].map((actualMinutes, i) => ({
    id: `s${i}`,
    taskId: String(i),
    startedAt: "2026-09-05T10:00:00Z",
    endedAt: "2026-09-05T20:00:00Z",
    pausedAt: null,
    pausedMs: 0,
    actualMinutes,
    completionReported: true,
    estimateAtStart: {
      minutes: 20,
      classId: "physics",
      workKind: "assignment",
      taskRevision: 0,
    },
    review: {
      reviewedAt: "2026-09-05T21:00:00Z",
      notes: "",
      remainingMinutes: null,
    },
  }));
  return { tasks, sessions };
}
const input = {
  classId: "physics",
  workKind: "assignment" as const,
  minutes: 30,
};
test("duration learning uses a robust median, matching class/type, with bounded optional estimates", () => {
  const { tasks, sessions } = fixture();
  assert.deepEqual(durationSuggestion(tasks, sessions, input), {
    minutes: 60,
    ratio: 2,
    samples: 3,
  });
  assert.equal(
    durationSuggestion(tasks, sessions, { ...input, classId: "other" }),
    null,
  );
  assert.equal(
    durationSuggestion(tasks, sessions, { ...input, workKind: "assessment" }),
    null,
  );
  assert.equal(
    durationSuggestion(tasks, sessions, { ...input, minutes: 2000 })?.minutes,
    2400,
  );
  assert.equal(
    durationSuggestion(tasks, sessions, { ...input, minutes: NaN }),
    null,
  );
  assert.equal(tasks[0]!.minutes, 20);
});
test("partial, unreviewed, changed, tiny, legacy, and multiple-session work cannot train estimates", () => {
  const exclusions: ((tasks: Task[], sessions: StudySession[]) => void)[] = [
    (t) => {
      t[0]!.completed = false;
    },
    (_, s) => {
      delete s[0]!.review;
    },
    (_, s) => {
      delete s[0]!.estimateAtStart;
    },
    (_, s) => {
      s[0]!.completionReported = false;
    },
    (_, s) => {
      s[0]!.actualMinutes = 4;
    },
    (_, s) => {
      s[0]!.actualMinutes = Infinity;
    },
    (t) => {
      t[0]!.revision = 1;
    },
    (t) => {
      t[0]!.minutes = 30;
    },
    (_, s) => {
      s.push({ ...s[0]!, id: "another" });
    },
  ];
  for (const exclude of exclusions) {
    const { tasks, sessions } = fixture();
    exclude(tasks, sessions);
    assert.equal(durationSuggestion(tasks, sessions, input), null);
  }
});
