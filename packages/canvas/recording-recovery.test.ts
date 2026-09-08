import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyNoteDocument, noteDocument } from "./notes";
import { DeskStore } from "../domain/store";
import {
  RECORDING_RECOVERY_MESSAGE,
  recoverInterruptedRecordingManifests,
  recoverNoteRecording,
  type RecordingManifest,
} from "./recording-recovery";

const startedAt = "2026-09-08T20:00:00.000Z";
const endedAt = "2026-09-08T20:07:30.000Z";

function manifest(canvasId: string, status: RecordingManifest["status"] = "recording"): RecordingManifest {
  return {
    version: 1,
    canvasId,
    startedAt,
    mimeType: "audio/webm;codecs=opus",
    chunkCount: 2,
    status,
  };
}

test("startup recovery preserves chunks, interrupts once, and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-recording-recovery-"));
  const recordingId = crypto.randomUUID();
  const canvasId = crypto.randomUUID();
  try {
    const directory = join(root, recordingId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest(canvasId)), "utf8");
    await writeFile(join(directory, "000000.chunk"), Buffer.from([1, 2, 3]));
    await writeFile(join(directory, "000001.chunk"), Buffer.from([4, 5, 6]));

    let callbacks = 0;
    const first = await recoverInterruptedRecordingManifests(
      root,
      async (id, previous, next) => {
        callbacks += 1;
        assert.equal(id, recordingId);
        assert.equal(previous.status, "recording");
        assert.equal(next.status, "interrupted");
      },
      new Date(endedAt),
    );
    assert.equal(callbacks, 1);
    assert.deepEqual(first.failed, []);
    assert.equal(first.recovered[0]?.manifest.status, "interrupted");
    assert.equal(first.recovered[0]?.manifest.chunkCount, 2);
    assert.deepEqual(await readFile(join(directory, "000000.chunk")), Buffer.from([1, 2, 3]));

    const saved = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as RecordingManifest;
    assert.equal(saved.status, "interrupted");
    assert.equal(saved.endedAt, endedAt);

    const second = await recoverInterruptedRecordingManifests(root, () => { callbacks += 1; }, new Date(endedAt));
    assert.deepEqual(second.recovered, []);
    assert.equal(callbacks, 1, "a terminal manifest must not be recovered twice");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete, failed, and already interrupted manifests remain unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-recording-recovery-terminal-"));
  try {
    for (const status of ["complete", "failed", "interrupted"] as const) {
      const id = crypto.randomUUID();
      const directory = join(root, id);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "manifest.json"), JSON.stringify({ ...manifest(crypto.randomUUID(), status), endedAt }), "utf8");
    }
    const result = await recoverInterruptedRecordingManifests(root, () => { throw Error("should not run"); }, new Date(endedAt));
    assert.deepEqual(result, { recovered: [], failed: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Note recovery preserves authored content and restores missing metadata", () => {
  const base = emptyNoteDocument();
  const recordingId = crypto.randomUUID();
  const source = noteDocument.parse({
    ...base,
    blocks: [{ ...base.blocks[0]!, text: "Torque sign conventions" }],
    recordings: [{
      id: recordingId,
      status: "recording",
      startedAt,
      chunkCount: 1,
      mimeType: "audio/webm",
      transcript: [{ id: "segment-1", startMs: 0, endMs: 500, text: "Torque is r cross F" }],
      events: [{ id: "event-1", atMs: 250, blockId: base.blocks[0]!.id, label: "diagram" }],
    }],
  });
  const nextManifest = { ...manifest(crypto.randomUUID()), endedAt };
  const recovered = recoverNoteRecording(source, recordingId, nextManifest);
  const nextRecording = recovered.document.recordings?.[0];
  assert.equal(recovered.changed, true);
  assert.equal(nextRecording?.status, "interrupted");
  assert.equal(nextRecording?.chunkCount, 2);
  assert.equal(nextRecording?.durationMs, 450_000);
  assert.equal(nextRecording?.error, RECORDING_RECOVERY_MESSAGE);
  assert.equal(nextRecording?.transcript?.[0]?.text, "Torque is r cross F");
  assert.equal(nextRecording?.events?.[0]?.label, "diagram");
  const textBlock = recovered.document.blocks.find((block): block is Extract<typeof block, { text: string }> => "text" in block);
  assert.equal(textBlock?.text, "Torque sign conventions");

  const second = recoverNoteRecording(recovered.document, recordingId, nextManifest);
  assert.equal(second.changed, false);
  assert.deepEqual(second.document, recovered.document);

  const missing = recoverNoteRecording(emptyNoteDocument(), recordingId, { ...nextManifest, chunkCount: 0 });
  assert.equal(missing.changed, true);
  assert.equal(missing.document.recordings?.[0]?.status, "interrupted");
  assert.equal(missing.document.recordings?.[0]?.chunkCount, 0, "zero chunks stay zero");
});

test("recovered Note metadata survives the canonical canvas store restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "desk-recording-recovery-store-"));
  const databasePath = join(root, "desk.sqlite");
  let store: DeskStore | undefined;
  try {
    store = new DeskStore(databasePath);
    let created = store.execute({ type: "class.create", name: "Recovery physics" });
    created = store.execute({
      type: "task.create",
      input: {
        title: "Interrupted lecture",
        classId: created.classes[0]!.id,
        dueAt: null,
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: false,
      },
    });
    created = store.execute({ type: "canvas.create", taskId: created.tasks[0]!.id });
    const canvasId = created.canvases.at(-1)!.id;
    const recordingId = crypto.randomUUID();
    const current = store.canvas(canvasId);
    const document = noteDocument.parse({
      ...emptyNoteDocument(),
      recordings: [{
        id: recordingId,
        status: "recording",
        startedAt,
        chunkCount: 1,
        mimeType: "audio/webm",
      }],
    });
    store.execute({
      type: "canvas.save",
      id: canvasId,
      revision: current.revision,
      scene: { ...current.scene, document },
    });

    const recordingDirectory = join(root, "recordings", recordingId);
    await mkdir(recordingDirectory, { recursive: true });
    await writeFile(join(recordingDirectory, "manifest.json"), JSON.stringify(manifest(canvasId)), "utf8");
    const result = await recoverInterruptedRecordingManifests(
      join(root, "recordings"),
      (id, previous, next) => {
        const canvas = store!.canvas(previous.canvasId);
        const recovered = recoverNoteRecording(noteDocument.parse(canvas.scene.document), id, next);
        if (recovered.changed)
          store!.execute({
            type: "canvas.save",
            id: canvas.id,
            revision: canvas.revision,
            scene: { ...canvas.scene, document: recovered.document },
          });
      },
      new Date(endedAt),
    );
    assert.equal(result.recovered.length, 1);
    store.close();
    store = new DeskStore(databasePath);
    const saved = store.canvas(canvasId).scene.document?.recordings?.find((item) => item.id === recordingId);
    assert.equal(saved?.status, "interrupted");
    assert.equal(saved?.chunkCount, 2);
    assert.equal(saved?.error, RECORDING_RECOVERY_MESSAGE);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
