import { test } from "node:test";
import assert from "node:assert/strict";
import type { Concept, Task } from "../domain/contracts";
import { activityInstruction, planStudyActivities } from "./activities";
import { compareStudyQuality } from "./evaluation";

const classId = "class-physics";
const task: Task = {
  id: "task-lecture",
  title: "Projectile lab",
  classId,
  dueAt: null,
  minutes: 45,
  resource: null,
  notes: "",
  deadlineConfirmed: true,
  completed: false,
  revision: 0,
  createdAt: "2026-09-06T12:00:00.000Z",
};
function concept(id: string, name: string, prerequisiteConceptIds?: string[]): Concept {
  return {
    id,
    classId,
    taskIds: [task.id],
    ...(prerequisiteConceptIds ? { prerequisiteConceptIds } : {}),
    name,
    status: "learning",
    preparedness: "developing",
    retentionMode: "course",
    reviewDue: null,
    attempts: 0,
    unaidedCorrect: 0,
    unaidedTotal: 0,
    hintCount: 0,
    lastReviewedAt: null,
    evidenceNote: "",
    revision: 0,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
}

test("adaptive activity planning chooses prerequisite recall before a checked attempt", () => {
  const prerequisite = concept("concept-vectors", "Vectors");
  const advanced = concept("concept-projectile", "Projectile motion", [prerequisite.id]);
  const plan = planStudyActivities(
    task,
    {
      concepts: [prerequisite, advanced],
      attempts: [],
      mistakes: [],
      sessions: [],
      assessments: [],
      teacherEvidence: [],
      tasks: [task],
      sources: [],
    },
    "standard",
    new Date("2026-09-06T12:00:00.000Z"),
  );
  assert.equal(plan.activities[0]?.kind, "recall");
  assert.deepEqual(plan.activities[0]?.conceptIds, [prerequisite.id]);
  assert.equal(plan.activities.at(-1)?.kind, "check");
  assert.match(plan.activities[0]?.rationale ?? "", /Prerequisite/);
});

test("quiz and exam activities share the plan but enforce different feedback contracts", () => {
  const conceptRecord = concept("concept-energy", "Energy");
  const quiz = planStudyActivities(task, { concepts: [conceptRecord], attempts: [], mistakes: [], sessions: [], assessments: [], teacherEvidence: [], tasks: [task], sources: [] }, "quiz", new Date("2026-09-06T12:00:00.000Z"));
  const exam = planStudyActivities(task, { concepts: [conceptRecord], attempts: [], mistakes: [], sessions: [], assessments: [], teacherEvidence: [], tasks: [task], sources: [] }, "exam", new Date("2026-09-06T12:00:00.000Z"));
  assert.equal(quiz.activities[0]?.kind, "quiz");
  assert.equal(quiz.activities[0]?.feedback, "immediate");
  assert.equal(exam.activities[0]?.kind, "exam");
  assert.equal(exam.activities[0]?.hintsAllowed, false);
  assert.equal(exam.activities[0]?.feedback, "none");
});

test("activity contracts prevent answer leakage for checks and hints", () => {
  assert.match(activityInstruction("check"), /do not reveal a final answer/i);
  assert.match(activityInstruction("hint"), /smallest useful next step/i);
  assert.match(activityInstruction("exam"), /Do not provide hints/i);
});

test("quality harness compares V1 policy observations without claiming live provider quality", () => {
  const result = compareStudyQuality(
    [{ scenario: "check", answerLeakage: true, hintUseful: false, diagnosticAccurate: false, repeatedQuestion: true, transferQuality: false, citationAccurate: true, evidenceCorrect: false, completed: true }],
    [{ scenario: "check", answerLeakage: false, hintUseful: true, diagnosticAccurate: true, repeatedQuestion: false, transferQuality: true, citationAccurate: true, evidenceCorrect: true, completed: true }],
  );
  assert.equal(result.delta.answerLeakageRate, -1);
  assert.equal(result.delta.hintUsefulnessRate, 1);
  assert.equal(result.postV1.scenarios, 1);
});
