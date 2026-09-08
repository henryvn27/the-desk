import { test } from "node:test";
import assert from "node:assert/strict";
import { DeskStore } from "../domain/store";
import { deriveDeskIntelligence } from "./desk-intelligence";

test("desk intelligence connects canonical evidence to an executable next action", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "AP Physics C" }).classes[0]!.id;
    // Keep this projection fixture independent of the wall clock. Automatic
    // planning is exercised by its own tests; this test is about the
    // intelligence projection selecting the canonical task and evidence.
    store.execute({ type: "planning.mode", mode: "suggest" });
    const taskId = store.execute({ type: "task.create", input: { title: "Forces problem set", classId, dueAt: "2026-09-10T23:00:00.000Z", minutes: 45, resource: null, notes: "", deadlineConfirmed: true } }).tasks[0]!.id;
    const conceptId = store.execute({ type: "concept.create", input: { classId, taskIds: [taskId], name: "Friction", status: "learning", preparedness: "developing", retentionMode: "course", reviewDue: null, attempts: 0, unaidedCorrect: 0, unaidedTotal: 0, hintCount: 0, lastReviewedAt: null, evidenceNote: "" } }).concepts[0]!.id;
    store.execute({ type: "attempt.create", input: { classId, taskId, conceptIds: [conceptId], result: "incorrect", unaided: true, hintCount: 0, notes: "Sign error", attemptedAt: "2026-09-07T11:00:00.000Z" } });
    const projection = deriveDeskIntelligence(store.snapshot(), new Date("2026-09-07T12:00:00.000Z"));
    assert.equal(projection.version, "desk-intelligence-v1");
    assert.equal(projection.nextAction.kind, "start-task");
    assert.equal(projection.nextAction.taskId, taskId);
    assert.equal(projection.nextAction.actions[0]?.id, "start");
    assert.ok(projection.nextAction.evidence.length > 0);
    assert.equal(projection.nextAction.estimatedMinutes, 45);
    assert.equal(projection.nextBestAction.taskId, taskId);
    assert.equal(projection.nextBestAction.kind, "assignment");
    assert.ok(projection.nextBestAction.reason.factors.length > 0);
    assert.ok(projection.learningLoop.effectiveLearning);
    assert.equal(projection.classes[0]?.learningObjective?.conceptId, conceptId);
    assert.equal(projection.evidence.attempts, 1);
    assert.equal(projection.sourceFingerprint.length, 64);
    assert.ok(projection.limitations.some((item) => /checked/i.test(item)));
  } finally {
    store.close();
  }
});
