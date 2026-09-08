import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  noteDocument,
  updateNoteRecording,
  type NoteDocument,
  type NoteRecording,
} from "./notes";

/** The on-disk manifest is the durable boundary for an in-progress recording. */
export const recordingManifest = z.strictObject({
  version: z.literal(1),
  canvasId: z.string().uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  mimeType: z.string().trim().max(80),
  chunkCount: z.number().int().min(0).max(100_000),
  status: z.enum(["recording", "complete", "interrupted", "failed"]),
});
export type RecordingManifest = z.infer<typeof recordingManifest>;

export const RECORDING_RECOVERY_MESSAGE = "Recovered after The Desk closed while recording.";

const recordingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECORDING_DURATION_MS = 24 * 60 * 60 * 1000;

export type RecoveredRecording = {
  recordingId: string;
  manifest: RecordingManifest;
};

export type FailedRecordingRecovery = {
  recordingId: string;
  error: string;
};

export type RecordingRecoveryResult = {
  recovered: RecoveredRecording[];
  failed: FailedRecordingRecovery[];
};

export type RecordingRecoveryCallback = (
  recordingId: string,
  manifest: RecordingManifest,
  next: RecordingManifest,
) => Promise<void> | void;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Recording recovery failed.";
}

function durationMs(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
  return Math.max(0, Math.min(MAX_RECORDING_DURATION_MS, ended - started));
}

export function interruptedManifest(manifest: RecordingManifest, endedAt: string): RecordingManifest {
  if (manifest.status !== "recording") return manifest;
  return { ...manifest, status: "interrupted", endedAt };
}

export type RecoveredNoteRecording = {
  document: NoteDocument;
  changed: boolean;
};

/**
 * Reconcile a durable recording manifest into its Note without replacing any
 * student-authored transcript, markers, or blocks. A missing Note entry is
 * restored from the manifest so a crash between recording start and the next
 * Note save does not make the captured audio unreachable.
 */
export function recoverNoteRecording(
  document: NoteDocument,
  recordingId: string,
  manifest: RecordingManifest,
): RecoveredNoteRecording {
  const current = document.recordings?.find((recording) => recording.id === recordingId);
  if (current && current.status !== "recording") return { document, changed: false };

  const update: Partial<NoteRecording> = {
    status: "interrupted",
    endedAt: manifest.endedAt,
    durationMs: durationMs(manifest.startedAt, manifest.endedAt ?? manifest.startedAt),
    chunkCount: manifest.chunkCount,
    mimeType: manifest.mimeType,
    error: RECORDING_RECOVERY_MESSAGE,
  };
  if (current)
    return { document: updateNoteRecording(document, recordingId, update), changed: true };

  const recovered: NoteRecording = {
    id: recordingId,
    status: "interrupted",
    startedAt: manifest.startedAt,
    endedAt: manifest.endedAt,
    durationMs: update.durationMs,
    chunkCount: manifest.chunkCount,
    mimeType: manifest.mimeType,
    error: RECORDING_RECOVERY_MESSAGE,
  };
  return {
    document: noteDocument.parse({
      ...document,
      recordings: [...(document.recordings ?? []), recovered],
    }),
    changed: true,
  };
}

/**
 * Convert manifests left in `recording` state by a prior process lifetime.
 * The callback persists Note metadata first; only then is the manifest made
 * terminal. A callback or write failure leaves the manifest untouched so the
 * next startup can retry without losing chunks or duplicating a recording.
 */
export async function recoverInterruptedRecordingManifests(
  root: string,
  callback: RecordingRecoveryCallback,
  now = new Date(),
): Promise<RecordingRecoveryResult> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { recovered: [], failed: [] };
    throw error;
  }

  const recovered: RecoveredRecording[] = [];
  const failed: FailedRecordingRecovery[] = [];
  const endedAt = now.toISOString();

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !recordingIdPattern.test(entry.name)) continue;
    const recordingId = entry.name;
    const manifestPath = join(root, recordingId, "manifest.json");
    let manifest: RecordingManifest;
    try {
      manifest = recordingManifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    } catch {
      // A partial or unrelated directory is not a recording we can safely
      // rewrite. Leave it available for diagnostics and ignore this pass.
      continue;
    }
    if (manifest.status !== "recording") continue;

    const next = interruptedManifest(manifest, endedAt);
    try {
      await callback(recordingId, manifest, next);
      await writeFile(manifestPath, JSON.stringify(next), "utf8");
      recovered.push({ recordingId, manifest: next });
    } catch (error) {
      failed.push({ recordingId, error: errorMessage(error) });
    }
  }

  return { recovered, failed };
}
