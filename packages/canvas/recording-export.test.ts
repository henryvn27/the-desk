import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { exportRecordingStorage } from "./recording-export";
import type { RecordingManifest } from "./recording-recovery";

function manifest(canvasId: string, status: RecordingManifest["status"], chunkCount: number): RecordingManifest {
  return {
    version: 1,
    canvasId,
    startedAt: "2026-09-08T10:00:00.000Z",
    ...(status === "recording" ? {} : { endedAt: "2026-09-08T10:03:00.000Z" }),
    mimeType: "audio/webm",
    chunkCount,
    status,
  };
}

async function writeRecording(root: string, id: string, value: RecordingManifest, chunks: string[]) {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify(value), "utf8");
  for (const [index, chunk] of chunks.entries())
    await writeFile(join(directory, `${String(index).padStart(6, "0")}.chunk`), chunk);
}

test("exports every valid recording state, including active and zero-chunk recordings", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "desk-recording-export-"));
  try {
    const source = join(root, "note-recordings");
    const destination = join(root, "saved", "the-desk-recordings");
    await mkdir(source, { recursive: true });
    const canvasId = "00000000-0000-4000-8000-000000000001";
    await writeRecording(source, "00000000-0000-4000-8000-000000000101", manifest(canvasId, "complete", 1), ["audio-a"]);
    await writeRecording(source, "00000000-0000-4000-8000-000000000102", manifest(canvasId, "failed", 0), []);
    await writeRecording(source, "00000000-0000-4000-8000-000000000103", manifest(canvasId, "interrupted", 2), ["audio-b", "audio-c"]);
    await writeRecording(source, "00000000-0000-4000-8000-000000000104", manifest(canvasId, "recording", 0), []);

    const result = await exportRecordingStorage(source, destination);
    assert.equal(result.recordingCount, 4);
    assert.equal(result.fileCount, 7);
    assert.ok(result.byteCount > 0);
    assert.equal(await readFile(join(destination, "00000000-0000-4000-8000-000000000103", "000001.chunk"), "utf8"), "audio-c");
    assert.deepEqual(await readdir(join(destination, "00000000-0000-4000-8000-000000000104")), ["manifest.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails closed for unsafe entries and never leaves a partial export", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "desk-recording-export-boundary-"));
  try {
    const source = join(root, "note-recordings");
    const destination = join(root, "saved", "the-desk-recordings");
    await mkdir(join(source, "00000000-0000-4000-8000-000000000201"), { recursive: true });
    await writeFile(join(source, "00000000-0000-4000-8000-000000000201", "manifest.json"), JSON.stringify(manifest("00000000-0000-4000-8000-000000000001", "complete", 0)));
    await mkdir(join(source, "00000000-0000-4000-8000-000000000201", "unexpected"));
    await assert.rejects(exportRecordingStorage(source, destination), /unsupported file/);
    await assert.rejects(readdir(destination), /ENOENT/);
    await assert.rejects(exportRecordingStorage(source, join(source, "nested")), /outside Desk recording storage/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty recording storage is a truthful no-op", async () => {
  const root = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "desk-recording-export-empty-"));
  try {
    const result = await exportRecordingStorage(join(root, "missing"), join(root, "saved"));
    assert.deepEqual(result, { recordingCount: 0, fileCount: 0, byteCount: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
