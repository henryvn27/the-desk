import assert from "node:assert/strict";
import test from "node:test";
import { canvasScene } from "./scene";
import {
  emptyNoteDocument,
  appendNoteEditEvent,
  insertNoteBlock,
  markdownShortcut,
  noteDocumentText,
  noteHeadings,
  removeNoteBlock,
  updateNoteRecording,
  updateNoteBlock,
} from "./notes";

test("legacy Canvas scenes remain valid and Notes blocks are additive", () => {
  const legacy = canvasScene.parse({
    engine: "excalidraw",
    version: 1,
    elements: [],
    files: {},
    viewBackgroundColor: "#fff",
  });
  const document = emptyNoteDocument();
  const withHeading = updateNoteBlock(document, document.blocks[0]!.id, {
    type: "heading",
    level: 1,
    text: "Calculus",
  });
  const scene = canvasScene.parse({ ...legacy, document: withHeading });
  assert.equal(scene.document?.blocks[0]?.type, "heading");
  assert.equal(canvasScene.parse(legacy).document, undefined);
});

test("keyboard Markdown shortcuts and stable block operations preserve outline text", () => {
  const document = emptyNoteDocument();
  const first = document.blocks[0]!;
  assert.equal(first.type, "paragraph");
  const heading = markdownShortcut({ ...first, text: "## Derivatives" });
  assert.equal(heading.type, "heading");
  const withHeading = updateNoteBlock(document, first.id, heading);
  const withList = insertNoteBlock(withHeading, first.id, {
    id: "list-1",
    type: "list",
    ordered: false,
    indent: 1,
    text: "Chain rule",
  });
  assert.deepEqual(noteHeadings(withList).map((item) => item.text), ["Derivatives"]);
  assert.match(noteDocumentText(withList), /Chain rule/);
  assert.equal(removeNoteBlock(withList, "list-1").blocks.length, 1);
});

test("paper captures and recording markers remain searchable beside original blocks", () => {
  const document = emptyNoteDocument();
  const recordingId = "recording-1";
  const withCapture = {
    ...document,
    captures: [{ id: "capture-1", kind: "paper" as const, originalFileId: "file-1", ocrText: "Newton force diagram", mathExpressions: ["F = ma"] }],
    recordings: [{ id: recordingId, status: "recording" as const, startedAt: "2026-09-06T12:00:00.000Z", chunkCount: 2, mimeType: "audio/webm", events: [] }],
  };
  const marked = updateNoteRecording(withCapture, recordingId, { status: "complete", endedAt: "2026-09-06T12:10:00.000Z", durationMs: 600_000, events: [{ id: "event-1", atMs: 30_000, blockId: document.blocks[0]!.id, label: "Diagram" }], transcript: [{ id: "segment-1", startMs: 0, endMs: 10_000, text: "force equals mass times acceleration" }] });
  assert.match(noteDocumentText({ ...marked, blocks: [...marked.blocks, { id: "p-2", type: "paragraph", text: "" }] }), /Newton force diagram/);
  assert.match(noteDocumentText(marked), /force equals mass/);
  assert.equal(marked.recordings?.[0]?.events?.[0]?.blockId, document.blocks[0]!.id);
});

test("recording edit markers are durable and stop after a recording is finished", () => {
  const document = emptyNoteDocument();
  const recordingId = "recording-edit-1";
  const recording = {
    id: recordingId,
    status: "recording" as const,
    startedAt: "2026-09-06T12:00:00.000Z",
    chunkCount: 0,
    mimeType: "audio/webm",
    events: [],
  };
  const withRecording = { ...document, recordings: [recording] };
  const marked = appendNoteEditEvent(withRecording, recordingId, document.blocks[0]!.id, 1250);
  assert.equal(marked.recordings?.[0]?.events?.[0]?.atMs, 1250);
  const finished = updateNoteRecording(marked, recordingId, { status: "complete", endedAt: "2026-09-06T12:01:00.000Z" });
  assert.equal(appendNoteEditEvent(finished, recordingId, document.blocks[0]!.id, 2000), finished);
});
