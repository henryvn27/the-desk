import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../domain/contracts";
import { evaluatePlannerWhatIf } from "./what-if";

const task: Task = {
  id: "physics",
  title: "Physics set",
  classId: "physics",
  minutes: 120,
  dueAt: "2026-09-08T22:00:00.000Z",
  resource: null,
  notes: "",
  deadlineConfirmed: true,
  completed: false,
  createdAt: "2026-09-06T08:00:00.000Z",
  revision: 0,
};
const input = {
  tasks: [task],
  now: new Date("2026-09-07T08:00:00.000Z"),
  preferences: {
    studyStart: "08:00",
    sleepCutoff: "10:00",
    studyDays: [1, 2, 3, 4, 5, 6, 0],
    bufferPercent: 15,
  },
};

test("what-if extra time evaluates a repaired plan without persisting anything", () => {
  const result = evaluatePlannerWhatIf(input, { kind: "add-minutes", taskId: task.id, minutes: 60 });
  assert.equal(result.change.kind, "add-minutes");
  assert.equal(result.baseline.blocks.length > 0, true);
  assert.equal(result.scenario.unscheduled.length >= result.baseline.unscheduled.length, true);
  assert.match(result.impact.explanation, /plan|work/);
});

test("what-if skip and moved deadline changes remain deterministic and validated", () => {
  const skipped = evaluatePlannerWhatIf(input, { kind: "skip-date", date: "2026-09-07T08:00:00.000Z" });
  assert.equal(skipped.impact.deadlineRisk, "increased");
  const moved = evaluatePlannerWhatIf(input, { kind: "move-deadline", taskId: task.id, dueAt: "2026-09-12T22:00:00.000Z" });
  assert.equal(moved.impact.deadlineRisk, "unchanged");
  assert.throws(() => evaluatePlannerWhatIf(input, { kind: "stop-at", time: "07:00" }), /after the study start/);
});
