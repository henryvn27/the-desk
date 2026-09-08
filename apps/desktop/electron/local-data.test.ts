import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { join, parse } from "node:path";
import { clearDeskRecordingStorage, deskRecordingStoragePath } from "./local-data";

test("local-data cleanup removes all Desk recordings and preserves siblings", async () => {
  const userDataPath = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "desk-local-data-"));
  try {
    const recordings = deskRecordingStoragePath(userDataPath);
    await mkdir(join(recordings, "recording-a"), { recursive: true });
    await mkdir(join(recordings, "recording-b"), { recursive: true });
    await writeFile(join(recordings, "recording-a", "000000.chunk"), "audio-a");
    await writeFile(join(recordings, "recording-a", "manifest.json"), "{}");
    await writeFile(join(recordings, "recording-b", "000000.chunk"), "audio-b");
    const sibling = join(userDataPath, "keep-me.txt");
    await writeFile(sibling, "outside Desk recording storage");

    await clearDeskRecordingStorage(userDataPath);

    await assert.rejects(readFile(recordings), /ENOENT/);
    assert.equal(await readFile(sibling, "utf8"), "outside Desk recording storage");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("local-data cleanup refuses the filesystem root and propagates an unusable boundary", async () => {
  assert.throws(() => deskRecordingStoragePath(parse(process.cwd()).root), /outside Desk local data/);

  const directory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "desk-local-data-boundary-"));
  const fileBoundary = join(directory, "not-a-directory");
  try {
    await writeFile(fileBoundary, "do not remove");
    await assert.rejects(clearDeskRecordingStorage(fileBoundary));
    assert.equal(await readFile(fileBoundary, "utf8"), "do not remove");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
