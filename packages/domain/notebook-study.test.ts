import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeskStore } from "./store";

const now = new Date("2026-09-07T12:00:00.000Z");

test("study material and artifacts persist locally with revision checks", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-notebook-study-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    let state = store.execute({ type: "class.create", name: "AP Physics C" }, now);
    const classId = state.classes[0]!.id;
    state = store.execute({
      type: "source.create",
      input: {
        title: "Forces handout",
        text: "Net force equals mass times acceleration.",
        classIds: [classId],
        taskIds: [],
        format: "text",
        sourceUrl: null,
      },
    }, now);
    const sourceId = state.sources[0]!.id;
    state = store.execute({ type: "canvas.create", classId }, now);
    const noteId = state.canvases[0]!.id;
    state = store.execute({
      type: "study.material.create",
      input: {
        title: "AP Physics C",
        classId,
        assessmentId: null,
        taskId: null,
        sourceIds: [sourceId],
        noteIds: [noteId],
        sourceFingerprint: "fingerprint-1",
        externalNotebookId: null,
        externalSourceIds: {},
        externalSourceFingerprints: {},
      },
    }, now);
    const material = state.studyMaterialSets[0]!;
    assert.equal(material.classId, classId);
    state = store.execute({
      type: "study.artifact.create",
      input: {
        type: "quiz",
        title: material.title,
        materialSetId: material.id,
        provider: "fake",
        status: "ready",
        externalNotebookId: null,
        externalArtifactId: "fake-quiz-1",
        sourceFingerprint: material.sourceFingerprint,
        payload: {
          kind: "quiz",
          questions: [{
            id: "q1",
            prompt: "What is force?",
            choices: ["ma", "m/a"],
            answerIndex: 0,
            explanation: "Newton's second law.",
            sourceIds: [sourceId],
            conceptIds: [],
          }],
          answers: [],
          currentIndex: 0,
          completedAt: null,
          score: null,
        },
        playbackPositionMs: 0,
        completed: false,
        generationOptions: { questionCount: 1 },
        error: null,
      },
    }, now);
    const artifact = state.studyArtifacts[0]!;
    assert.equal(artifact.status, "ready");
    assert.throws(() => store.execute({
      type: "study.artifact.update",
      id: artifact.id,
      revision: 99,
      input: { completed: true },
    }, now), /changed/);
    state = store.execute({
      type: "study.artifact.update",
      id: artifact.id,
      revision: artifact.revision,
      input: { completed: true, playbackPositionMs: 12_345 },
    }, now);
    assert.equal(state.studyArtifacts[0]!.completed, true);
    assert.equal(state.studyArtifacts[0]!.playbackPositionMs, 12_345);
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().studyMaterialSets[0]!.id, material.id);
    assert.equal(store.snapshot().studyArtifacts[0]!.completed, true);
    assert.equal(store.snapshot().studyArtifacts[0]!.playbackPositionMs, 12_345);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("quiz Attempts created from an active StudySession become session evidence", () => {
  const store = new DeskStore(":memory:");
  try {
    let state = store.execute({ type: "class.create", name: "AP Physics C" }, now);
    const classId = state.classes[0]!.id;
    state = store.execute({
      type: "task.create",
      input: {
        title: "Review forces",
        classId,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }, now);
    const taskId = state.tasks[0]!.id;
    state = store.execute({ type: "session.start", taskId, mode: "quiz" }, now);
    const session = state.sessions.find((candidate) => !candidate.endedAt)!;
    const activityId = session.activityState!.currentId!;
    state = store.execute({
      type: "attempt.create",
      input: {
        classId,
        taskId,
        conceptIds: [],
        result: "correct",
        unaided: true,
        hintCount: 0,
        notes: "Quiz answer",
        attemptedAt: now.toISOString(),
        activityId,
        activityKind: "quiz",
        responseMode: "multiple-choice",
      },
    }, now);
    const active = state.sessions.find((candidate) => candidate.id === session.id)!;
    assert.deepEqual(active.evidenceAttemptIds, [state.attempts[0]!.id]);
    state = store.execute({ type: "session.end", completed: false }, now);
    assert.equal(state.sessions[0]!.summary?.checkedAttemptCount, 1);
    assert.equal(state.sessions[0]!.summary?.evidenceQuality, "useful");
  } finally {
    store.close();
  }
});
