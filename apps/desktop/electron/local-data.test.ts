import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { join, parse } from "node:path";
import {
  clearDeskRecordingStorage,
  deleteDeskLocalData,
  deskRecordingStoragePath,
  recoverPendingDeskRecordingStorage,
  restoreDeskRecordingStorage,
  stageDeskRecordingStorage,
} from "./local-data";

test("local-data cleanup removes all Desk recordings and preserves siblings", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desk-local-data-"));
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

  const directory = await mkdtemp(join(tmpdir(), "desk-local-data-boundary-"));
  const fileBoundary = join(directory, "not-a-directory");
  try {
    await writeFile(fileBoundary, "do not remove");
    await assert.rejects(clearDeskRecordingStorage(fileBoundary));
    assert.equal(await readFile(fileBoundary, "utf8"), "do not remove");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("staged recording storage restores after an interrupted wipe", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desk-local-data-stage-"));
  try {
    const recordings = deskRecordingStoragePath(userDataPath);
    await mkdir(join(recordings, "recording-a"), { recursive: true });
    await writeFile(join(recordings, "recording-a", "000000.chunk"), "audio-a");

    const stage = await stageDeskRecordingStorage(userDataPath);
    assert.equal(stage.moved, true);
    await assert.rejects(readFile(recordings), /ENOENT/);
    await restoreDeskRecordingStorage(stage);
    assert.equal(await readFile(join(recordings, "recording-a", "000000.chunk"), "utf8"), "audio-a");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("pending recording storage is restored on the next app lifetime", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desk-local-data-recover-"));
  try {
    const recordings = deskRecordingStoragePath(userDataPath);
    await mkdir(join(recordings, "recording-a"), { recursive: true });
    await writeFile(join(recordings, "recording-a", "000000.chunk"), "audio-a");
    await stageDeskRecordingStorage(userDataPath);

    assert.equal(await recoverPendingDeskRecordingStorage(userDataPath), "restored");
    assert.equal(await recoverPendingDeskRecordingStorage(userDataPath), "none");
    assert.equal(await readFile(join(recordings, "recording-a", "000000.chunk"), "utf8"), "audio-a");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("local-data wipe restores recordings when SQLite cleanup fails", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desk-local-data-db-failure-"));
  const events: string[] = [];
  try {
    const recordings = deskRecordingStoragePath(userDataPath);
    await mkdir(join(recordings, "recording-a"), { recursive: true });
    await writeFile(join(recordings, "recording-a", "000000.chunk"), "audio-a");

    await assert.rejects(
      deleteDeskLocalData({
        userDataPath,
        clearRecordingSessions: () => events.push("clear"),
        closeStore: () => events.push("close"),
        reopenStore: () => events.push("reopen"),
        removeDatabase: async () => {
          events.push("database");
          throw new Error("database cleanup failed");
        },
      }),
      /database cleanup failed/,
    );
    assert.deepEqual(events, ["clear", "close", "database", "reopen"]);
    assert.equal(await readFile(join(recordings, "recording-a", "000000.chunk"), "utf8"), "audio-a");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("local-data wipe reports partial deletion and restores recordings when final cleanup fails", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desk-local-data-recording-failure-"));
  const events: string[] = [];
  try {
    const recordings = deskRecordingStoragePath(userDataPath);
    await mkdir(join(recordings, "recording-a"), { recursive: true });
    await writeFile(join(recordings, "recording-a", "000000.chunk"), "audio-a");

    await assert.rejects(
      deleteDeskLocalData({
        userDataPath,
        clearRecordingSessions: () => events.push("clear"),
        closeStore: () => events.push("close"),
        reopenStore: () => events.push("reopen"),
        removeDatabase: async () => {
          events.push("database");
        },
        removeStagedRecordings: async () => {
          events.push("recordings");
          throw new Error("recording cleanup failed");
        },
      }),
      /partially deleted.*lecture recordings remain/i,
    );
    assert.deepEqual(events, ["clear", "close", "database", "recordings", "reopen"]);
    assert.equal(await readFile(join(recordings, "recording-a", "000000.chunk"), "utf8"), "audio-a");
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("local-data wipe removes staged recordings after successful SQLite cleanup", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "desk-local-data-success-"));
  const events: string[] = [];
  try {
    const recordings = deskRecordingStoragePath(userDataPath);
    await mkdir(join(recordings, "recording-a"), { recursive: true });
    await writeFile(join(recordings, "recording-a", "000000.chunk"), "audio-a");

    await deleteDeskLocalData({
      userDataPath,
      clearRecordingSessions: () => events.push("clear"),
      closeStore: () => events.push("close"),
      reopenStore: () => events.push("reopen"),
      removeDatabase: async () => {
        events.push("database");
      },
    });
    assert.deepEqual(events, ["clear", "close", "database", "reopen"]);
    await assert.rejects(readFile(recordings), /ENOENT/);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
});
