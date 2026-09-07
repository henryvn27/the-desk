import { test } from "node:test";
import assert from "node:assert/strict";
import type { Attempt, StudySession } from "../domain/contracts";
import { inferSessionSummary } from "./session-summary";
import { planStudyActivities } from "./activities";

test("session summary distinguishes time/completion from checked learning evidence", () => {
  const session: StudySession = {
    id: "session-1",
    taskId: "task-1",
    startedAt: "2026-09-06T12:00:00.000Z",
    pausedAt: null,
    pausedMs: 0,
    endedAt: "2026-09-06T12:30:00.000Z",
    actualMinutes: 30,
    completionReported: true,
    activityState: {
      mode: "standard",
      activities: planStudyActivities(
        { id: "task-1", title: "Algebra", classId: "class-1", dueAt: null, minutes: 30, resource: null, notes: "", deadlineConfirmed: true, completed: false, revision: 0, createdAt: "2026-09-06T12:00:00.000Z" },
        { concepts: [], attempts: [], mistakes: [], sessions: [], assessments: [], teacherEvidence: [], tasks: [], sources: [] },
        "standard",
        new Date("2026-09-06T12:00:00.000Z"),
      ).activities,
      currentId: null,
      revision: 1,
      startedAt: "2026-09-06T12:00:00.000Z",
      submittedAt: "2026-09-06T12:30:00.000Z",
    },
  };
  const attempts: Attempt[] = [];
  const summary = inferSessionSummary(session, attempts, [], new Date("2026-09-06T12:31:00.000Z"));
  assert.equal(summary.evidenceQuality, "none");
  assert.equal(summary.nextAction, "record-a-checked-attempt");
  assert.match(summary.caveats.join(" "), /does not certify mastery/);
});
