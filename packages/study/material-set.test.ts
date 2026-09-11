import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStudyMaterialSet, noteTextForStudy } from "./material-set";
import type { Snapshot } from "../domain/contracts";

const id = (value: string) => `00000000-0000-4000-8000-${value.padStart(12, "0")}`;

function snapshot(): Snapshot {
  const classId = id("1");
  const sourceId = id("2");
  return {
    classes: [{ id: classId, name: "AP Physics C", color: "#557562" }],
    sources: [{
      id: sourceId,
      title: "Forces handout",
      text: "Net force equals mass times acceleration.",
      classIds: [classId],
      taskIds: [],
      kind: "class-material",
      format: "text",
      sourceUrl: null,
      authority: "user-provided-text",
      createdAt: "2026-09-07T12:00:00.000Z",
      revision: 0,
    }],
    assessments: [],
    tasks: [],
    canvases: [],
    studyMaterialSets: [],
    studyArtifacts: [],
  } as unknown as Snapshot;
}

test("material resolver references existing Sources and Notes without copying them", () => {
  const state = snapshot();
  const classId = state.classes[0]!.id;
  const note = {
    id: id("3"),
    classId,
    taskId: null,
    title: "Lecture notes",
    revision: 2,
    scene: {
      engine: "excalidraw" as const,
      version: 1 as const,
      elements: [],
      files: {},
      viewBackgroundColor: "#ffffff",
      document: { version: 1 as const, blocks: [{ id: "block", type: "paragraph" as const, text: "Draw the free body diagram." }] },
    },
  };
  const result = resolveStudyMaterialSet(state, { classId }, [note]);
  assert.deepEqual(result.sourceIds, [state.sources[0]!.id]);
  assert.deepEqual(result.noteIds, [note.id]);
  assert.equal(result.classId, classId);
  assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(noteTextForStudy(note), "Draw the free body diagram.");
});

test("resolver rejects an empty material set instead of generating unsupported content", () => {
  const state = snapshot();
  assert.throws(() => resolveStudyMaterialSet(state, { title: "Empty" }, []), /Source or Note/);
});

test("explicit Source and Note selections stay restrictive", () => {
  const state = snapshot();
  const classId = state.classes[0]!.id;
  const extraSourceId = id("4");
  state.sources.push({
    ...state.sources[0]!,
    id: extraSourceId,
    title: "Another handout",
    text: "A second source that should not be uploaded.",
  });
  const firstNote = {
    id: id("3"),
    classId,
    taskId: null,
    title: "Lecture notes",
    revision: 2,
    scene: {
      engine: "excalidraw" as const,
      version: 1 as const,
      elements: [],
      files: {},
      viewBackgroundColor: "#ffffff",
      document: { version: 1 as const, blocks: [{ id: "block", type: "paragraph" as const, text: "Draw the free body diagram." }] },
    },
  };
  const secondNote = { ...firstNote, id: id("5"), title: "Other notes" };
  const result = resolveStudyMaterialSet(state, { classId, sourceIds: [state.sources[0]!.id], noteIds: [firstNote.id] }, [firstNote, secondNote]);
  assert.deepEqual(result.sourceIds, [state.sources[0]!.id]);
  assert.deepEqual(result.noteIds, [firstNote.id]);
});

test("study text includes captured OCR, recognized math and recording transcript", () => {
  const note = {
    id: id("6"),
    classId: null,
    taskId: null,
    title: "Captured lecture",
    revision: 1,
    scene: {
      engine: "excalidraw" as const,
      version: 1 as const,
      elements: [],
      files: {},
      viewBackgroundColor: "#ffffff",
      document: {
        version: 1 as const,
        blocks: [{ id: "block", type: "paragraph" as const, text: "Lecture" }],
        captures: [{ id: "capture", kind: "paper" as const, originalFileId: "file", ocrText: "Newton's second law", mathExpressions: ["F = ma"] }],
        recordings: [{ id: "recording", status: "complete" as const, startedAt: "2026-09-07T12:00:00.000Z", chunkCount: 1, mimeType: "audio/webm", transcript: [{ id: "segment", startMs: 0, endMs: 1_000, text: "Force is mass times acceleration." }] }],
      },
    },
  };
  const text = noteTextForStudy(note);
  assert.match(text, /Newton's second law/);
  assert.match(text, /F = ma/);
  assert.match(text, /Force is mass times acceleration/);
});
