import { test } from "node:test";
import assert from "node:assert/strict";
import { DeskStore } from "./store";

test("StudyActivity plan, quiz/exam mode and inferred session summary persist through SQLite", () => {
  const store = new DeskStore(":memory:");
  try {
    let snapshot = store.execute({ type: "class.create", name: "Calculus" });
    const classId = snapshot.classes[0]!.id;
    snapshot = store.execute({ type: "task.create", input: { title: "Derivatives", classId, dueAt: null, minutes: 30, resource: null, notes: "", deadlineConfirmed: true } });
    const task = snapshot.tasks[0]!;
    snapshot = store.execute({ type: "concept.create", input: { classId, taskIds: [task.id], name: "Derivative rules", status: "learning", preparedness: "developing", retentionMode: "course", reviewDue: null, attempts: 0, unaidedCorrect: 0, unaidedTotal: 0, hintCount: 0, lastReviewedAt: null, evidenceNote: "" } });
    const concept = snapshot.concepts[0]!;
    snapshot = store.execute({ type: "session.start", taskId: task.id, mode: "quiz" });
    const quiz = snapshot.sessions[0]!;
    assert.equal(quiz.activityState?.mode, "quiz");
    assert.equal(quiz.activityState?.activities[0]?.kind, "quiz");
    const first = quiz.activityState!.activities[0]!;
    snapshot = store.execute({ type: "session.activity", activityId: first.id, action: "hint" });
    assert.equal(snapshot.sessions[0]!.activityState?.activities[0]?.hintCount, 1);
    snapshot = store.execute({ type: "session.activity", activityId: first.id, action: "complete" });
    snapshot = store.execute({ type: "session.end", completed: false });
    const ended = snapshot.sessions[0]!;
    assert.equal(ended.summary?.evidenceQuality, "none");
    snapshot = store.execute({ type: "session.review", id: ended.id, notes: "Checked the derivative setup.", remainingMinutes: null, attempts: [{ conceptIds: [concept.id], result: "correct", unaided: true, hintCount: 0, notes: "Applied the power rule.", activityId: first.id, activityKind: "quiz" }] });
    assert.equal(snapshot.attempts.length, 1);
    assert.equal(snapshot.sessions[0]!.summary?.evidenceQuality, "useful");
    assert.equal(snapshot.sessions[0]!.summary?.checkedAttemptCount, 1);
    assert.equal(snapshot.sessions[0]!.activityState?.submittedAt !== null, true);

    const nextTask = store.execute({ type: "task.create", input: { title: "Limits exam", classId, dueAt: null, minutes: 30, resource: null, notes: "", deadlineConfirmed: true } }).tasks.at(-1)!;
    const examSnapshot = store.execute({ type: "session.start", taskId: nextTask.id, mode: "exam" });
    const examActivity = examSnapshot.sessions.at(-1)!.activityState!.activities[0]!;
    assert.equal(examActivity.kind, "exam");
    assert.throws(() => store.execute({ type: "session.activity", activityId: examActivity.id, action: "hint" }), /does not provide hints/);
  } finally {
    store.close();
  }
});
