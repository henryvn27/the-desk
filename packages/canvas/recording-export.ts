import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { recordingManifest } from "./recording-recovery";

const recordingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const chunkPattern = /^\d{6}\.chunk$/;
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;

export type RecordingExportSummary = {
  recordingCount: number;
  fileCount: number;
  byteCount: number;
};

function isWithin(parent: string, child: string) {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

async function sourceEntries(root: string) {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Copy only Desk-owned lecture recording manifests and chunk files into a
 * newly-created folder. The staging rename prevents a failed export from
 * looking complete, and the allowlist keeps unrelated userData out.
 */
export async function exportRecordingStorage(
  sourceRoot: string,
  destinationRoot: string,
): Promise<RecordingExportSummary> {
  const source = resolve(sourceRoot);
  const destination = resolve(destinationRoot);
  if (isWithin(source, destination)) throw Error("Choose an export folder outside Desk recording storage.");
  if (basename(destination) === "" || dirname(destination) === destination)
    throw Error("Choose a valid export folder.");

  const entries = await sourceEntries(source);
  const recordings = entries.filter((entry) => entry.isDirectory() && recordingIdPattern.test(entry.name));
  if (entries.some((entry) => !entry.isDirectory() || !recordingIdPattern.test(entry.name)))
    throw Error("Desk recording storage contains an unexpected entry.");
  if (!recordings.length) return { recordingCount: 0, fileCount: 0, byteCount: 0 };

  const staging = `${destination}.partial-${randomUUID()}`;
  let fileCount = 0;
  let byteCount = 0;
  try {
    await mkdir(dirname(staging), { recursive: true });
    await mkdir(staging);
    for (const recording of recordings) {
      const sourceDirectory = join(source, recording.name);
      const targetDirectory = join(staging, recording.name);
      const files = await readdir(sourceDirectory, { withFileTypes: true });
      const manifest = files.find((entry) => entry.name === "manifest.json");
      if (!manifest || !manifest.isFile()) throw Error("A recording manifest is missing.");
      for (const file of files) {
        if (!file.isFile() || (file.name !== "manifest.json" && !chunkPattern.test(file.name)))
          throw Error("Desk recording storage contains an unsupported file.");
        const sourceFile = join(sourceDirectory, file.name);
        const size = (await stat(sourceFile)).size;
        if (size > MAX_FILE_BYTES || byteCount + size > MAX_TOTAL_BYTES)
          throw Error("Lecture recordings are too large to export in one batch.");
        if (file.name === "manifest.json") {
          recordingManifest.parse(JSON.parse(await readFile(sourceFile, "utf8")));
        }
        await mkdir(targetDirectory, { recursive: true });
        await copyFile(sourceFile, join(targetDirectory, file.name));
        fileCount += 1;
        byteCount += size;
      }
    }
    await rename(staging, destination);
    return { recordingCount: recordings.length, fileCount, byteCount };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
