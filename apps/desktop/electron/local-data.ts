import { lstat, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, parse, resolve, sep } from "node:path";

const RECORDING_DIRECTORY_NAME = "note-recordings";
const PENDING_RECORDING_DIRECTORY_NAME = "note-recordings.pending-delete";

export type DeskRecordingStorageStage = {
  originalPath: string;
  pendingPath: string;
  moved: boolean;
};

/**
 * Resolve the one Desk-owned recording directory that may be removed by the
 * local-data wipe. Keeping this boundary in one function makes it harder for
 * a future caller to accidentally broaden a destructive path.
 */
export function deskRecordingStoragePath(userDataPath: string): string {
  const parent = resolve(userDataPath);
  const root = resolve(parent, RECORDING_DIRECTORY_NAME);
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;

  if (
    parent === parse(parent).root ||
    dirname(root) !== parent ||
    basename(root) !== RECORDING_DIRECTORY_NAME ||
    !root.startsWith(prefix)
  ) {
    throw new Error("Refusing to delete outside Desk local data.");
  }

  return root;
}

function pendingRecordingStoragePath(userDataPath: string): string {
  const parent = resolve(userDataPath);
  const root = resolve(parent, PENDING_RECORDING_DIRECTORY_NAME);
  const prefix = parent.endsWith(sep) ? parent : `${parent}${sep}`;

  if (
    parent === parse(parent).root ||
    dirname(root) !== parent ||
    basename(root) !== PENDING_RECORDING_DIRECTORY_NAME ||
    !root.startsWith(prefix)
  ) {
    throw new Error("Refusing to stage recordings outside Desk local data.");
  }

  return root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Move recordings to a recoverable sibling while SQLite is being removed. */
export async function stageDeskRecordingStorage(
  userDataPath: string,
): Promise<DeskRecordingStorageStage> {
  const originalPath = deskRecordingStoragePath(userDataPath);
  const pendingPath = pendingRecordingStoragePath(userDataPath);
  if (await exists(pendingPath))
    throw new Error("A previous local-data deletion is still recoverable.");

  let info;
  try {
    info = await lstat(originalPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { originalPath, pendingPath, moved: false };
    throw error;
  }
  if (!info.isDirectory())
    throw new Error("Refusing to stage recordings outside Desk local data.");

  await rename(originalPath, pendingPath);
  return { originalPath, pendingPath, moved: true };
}

/** Restore staged recordings after a database failure or interrupted process. */
export async function restoreDeskRecordingStorage(
  stage: DeskRecordingStorageStage,
): Promise<void> {
  if (!stage.moved) return;
  if (await exists(stage.originalPath))
    throw new Error("Cannot restore recordings because the Desk recording directory already exists.");
  await rename(stage.pendingPath, stage.originalPath);
}

/** Permanently remove recordings after the database has been removed. */
export async function removeStagedDeskRecordingStorage(
  stage: DeskRecordingStorageStage,
): Promise<void> {
  if (!stage.moved) return;
  await rm(stage.pendingPath, { recursive: true, force: true });
}

/** Restore a pending deletion left by a terminated process. */
export async function recoverPendingDeskRecordingStorage(
  userDataPath: string,
): Promise<"none" | "restored" | "conflict"> {
  const originalPath = deskRecordingStoragePath(userDataPath);
  const pendingPath = pendingRecordingStoragePath(userDataPath);
  if (!(await exists(pendingPath))) return "none";
  if (await exists(originalPath)) return "conflict";
  await rename(pendingPath, originalPath);
  return "restored";
}

export type DeskLocalDataDeleteOptions = {
  userDataPath: string;
  closeStore: () => void;
  reopenStore: () => void;
  clearRecordingSessions: () => void;
  removeDatabase: () => Promise<void>;
  removeStagedRecordings?: (stage: DeskRecordingStorageStage) => Promise<void>;
};

/**
 * Delete SQLite and Desk-owned recordings with a recoverable boundary. Bytes
 * are staged before SQLite deletion and restored on either failure path.
 */
export async function deleteDeskLocalData(
  options: DeskLocalDataDeleteOptions,
): Promise<void> {
  const stage = await stageDeskRecordingStorage(options.userDataPath);
  options.clearRecordingSessions();
  options.closeStore();

  try {
    await options.removeDatabase();
  } catch (error) {
    try {
      await restoreDeskRecordingStorage(stage);
    } finally {
      options.reopenStore();
    }
    throw error;
  }

  try {
    await (options.removeStagedRecordings ?? removeStagedDeskRecordingStorage)(stage);
  } catch (error) {
    try {
      await restoreDeskRecordingStorage(stage);
    } finally {
      options.reopenStore();
    }
    throw new Error(
      "Local data was partially deleted. The database was removed, but lecture recordings remain. Export them before trying again.",
      { cause: error },
    );
  }

  options.reopenStore();
}

/** Remove Desk-owned lecture recordings while preserving every sibling file. */
export async function clearDeskRecordingStorage(userDataPath: string): Promise<void> {
  const parent = resolve(userDataPath);
  const info = await stat(parent);
  if (!info.isDirectory()) throw new Error("Refusing to delete outside Desk local data.");
  await rm(deskRecordingStoragePath(parent), {
    recursive: true,
    force: true,
  });
}
