import { rm, stat } from "node:fs/promises";
import { basename, dirname, parse, resolve, sep } from "node:path";

const RECORDING_DIRECTORY_NAME = "note-recordings";

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
