import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
test("capture → session → completion survives restart, enforces one session and excludes pauses", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-test-"));
  const path = join(directory, "test.sqlite");
  let store = new DeskStore(path);
  try {
    let s = store.execute({ type: "class.create", name: "AP Physics C" });
    s = store.execute({
      type: "task.create",
      input: {
        title: "Problems 8–14",
        classId: s.classes[0]!.id,
        dueAt: null,
        minutes: 45,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const id = s.tasks[0]!.id;
    store.execute(
      { type: "session.start", taskId: id },
      new Date("2026-09-05T12:00:00Z"),
    );
    assert.throws(() => store.execute({ type: "session.start", taskId: id }));
    store.execute({ type: "session.pause" }, new Date("2026-09-05T12:10:00Z"));
    store.close();
    store = new DeskStore(path);
    assert.equal(
      store.snapshot().sessions[0]!.pausedAt,
      "2026-09-05T12:10:00.000Z",
    );
    store.execute({ type: "session.resume" }, new Date("2026-09-05T12:20:00Z"));
    s = store.execute(
      { type: "session.end", completed: true },
      new Date("2026-09-05T12:35:00Z"),
    );
    assert.equal(s.sessions[0]!.actualMinutes, 25);
    assert.equal(s.tasks[0]!.completed, true);
    assert.throws(() => store.execute({ type: "task.undo", id }));
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().tasks[0]!.completed, true);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test("schema 1 data survives the telemetry migration and future schema is rejected", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "desk-upgrade-"));
  const path = join(directory, "legacy.sqlite");
  try {
    const old = new DatabaseSync(path);
    old.exec(
      `CREATE TABLE classes(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL);CREATE TABLE tasks(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),data TEXT NOT NULL);CREATE TABLE sessions(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),data TEXT NOT NULL,active INTEGER NOT NULL);CREATE UNIQUE INDEX one_active_session ON sessions(active) WHERE active=1;CREATE TABLE outbox(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL,operation TEXT NOT NULL,created_at TEXT NOT NULL);INSERT INTO classes VALUES('old-class','Physics','#50705A');PRAGMA user_version=1;`,
    );
    old.close();
    const migrated = new DeskStore(path);
    assert.equal(migrated.snapshot().classes[0]!.name, "Physics");
    migrated.close();
    const check = new DatabaseSync(path);
    assert.equal(check.prepare("PRAGMA user_version").get()!.user_version, 5);
    assert.equal(
      check.prepare("SELECT COUNT(*) AS n FROM ai_runs").get()!.n,
      0,
    );
    check.exec("PRAGMA user_version=99");
    check.close();
    assert.throws(() => new DeskStore(path), /newer Desk version/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("task correction preserves provenance and requires approval for authoritative deadline changes", () => {
  const store = new DeskStore(":memory:");
  try {
    const course = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const input = {
      title: "Friction",
      classId: course.id,
      dueAt: "2026-09-09T23:00:00.000Z",
      minutes: 30,
      resource: null,
      notes: "Teacher handout",
      deadlineConfirmed: true,
      captureEvidence: {
        originalText: "Friction due Wednesday",
        sourceText: "Friction due Wednesday",
        capturedAt: "2026-09-05T12:00:00.000Z",
        authority: "user-provided-text" as const,
        candidateDates: ["2026-09-09"],
        uncertainties: ["Time unknown"],
      },
    };
    const task = store.execute({ type: "task.create", input }).tasks[0]!;
    assert.throws(
      () =>
        store.execute({
          type: "task.update",
          id: task.id,
          input: { ...input, dueAt: "2026-09-10T23:00:00.000Z" },
          deadlineChangeApproved: false,
        }),
      /Approve/,
    );
    assert.equal(store.snapshot().tasks[0]!.dueAt, input.dueAt);
    const corrected = store.execute({
      type: "task.update",
      id: task.id,
      input: {
        ...input,
        title: "Friction corrections",
        dueAt: "2026-09-10T23:00:00.000Z",
        captureEvidence: undefined,
      },
      deadlineChangeApproved: true,
    }).tasks[0]!;
    assert.equal(corrected.id, task.id);
    assert.equal(corrected.createdAt, task.createdAt);
    assert.equal(
      corrected.captureEvidence?.originalText,
      input.captureEvidence.originalText,
    );
    assert.equal(corrected.dueAt, "2026-09-10T23:00:00.000Z");
    assert.throws(
      () =>
        store.execute({
          type: "task.update",
          id: task.id,
          input: { ...input, deadlineConfirmed: false },
          deadlineChangeApproved: false,
        }),
      /Approve/,
    );
  } finally {
    store.close();
  }
});

test("session review survives restart, updates remaining work, and rejects stale estimate writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-review-"));
  const path = join(directory, "db.sqlite");
  let store = new DeskStore(path);
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const taskId = store.execute({
      type: "task.create",
      input: {
        title: "Vectors",
        classId,
        dueAt: null,
        minutes: 60,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!.id;
    const sessionId = store.execute(
      { type: "session.start", taskId },
      new Date("2026-09-05T12:00:00Z"),
    ).sessions[0]!.id;
    assert.throws(
      () =>
        store.execute({
          type: "session.review",
          id: sessionId,
          notes: "",
          remainingMinutes: 30,
        }),
      /End this session/,
    );
    store.execute(
      { type: "session.end", completed: false },
      new Date("2026-09-05T12:20:00Z"),
    );
    store.execute({
      type: "session.review",
      id: sessionId,
      notes: "Worked on components; signs need review",
      remainingMinutes: 35,
    });
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().tasks[0]!.minutes, 35);
    assert.equal(store.snapshot().tasks[0]!.completed, false);
    assert.equal(store.snapshot().sessions[0]!.actualMinutes, 20);
    assert.equal(store.snapshot().sessions[0]!.completionReported, false);
    assert.equal(
      store.snapshot().sessions[0]!.review?.notes,
      "Worked on components; signs need review",
    );
    store.execute(
      { type: "session.start", taskId },
      new Date("2026-09-05T13:00:00Z"),
    );
    assert.throws(
      () =>
        store.execute({
          type: "session.review",
          id: sessionId,
          notes: "stale",
          remainingMinutes: 15,
        }),
      /newer session/,
    );
    assert.equal(store.snapshot().tasks[0]!.minutes, 35);
    assert.equal(
      store.snapshot().sessions[0]!.review?.notes,
      "Worked on components; signs need review",
    );
    const ended = store.execute(
      { type: "session.end", completed: true },
      new Date("2026-09-05T13:15:00Z"),
    ).sessions[1]!;
    assert.throws(
      () =>
        store.execute({
          type: "session.review",
          id: ended.id,
          notes: "",
          remainingMinutes: 10,
        }),
      /Completed work/,
    );
    store.execute({
      type: "session.review",
      id: ended.id,
      notes: "",
      remainingMinutes: null,
    });
    assert.ok(store.snapshot().sessions[1]!.review?.reviewedAt);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test("planning preferences persist and invalid window cannot overwrite them", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-prefs-"));
  const path = join(directory, "db.sqlite");
  let store = new DeskStore(path);
  try {
    const input = {
      studyStart: "16:00",
      sleepCutoff: "21:00",
      studyDays: [1, 3, 5],
      bufferPercent: 20,
    };
    store.execute({ type: "planning.preferences", input });
    assert.throws(() =>
      store.execute({
        type: "planning.preferences",
        input: { ...input, sleepCutoff: "09:00" },
      }),
    );
    store.close();
    store = new DeskStore(path);
    assert.deepEqual(store.snapshot().planning, input);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test("shared sources preserve exact text, enforce links atomically and survive restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-source-"));
  const path = join(directory, "db.sqlite");
  let store = new DeskStore(path);
  try {
    const a = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const b = store.execute({ type: "class.create", name: "Math" }).classes[1]!
      .id;
    const make = (classId: string) =>
      store
        .execute({
          type: "task.create",
          input: {
            title: "Vectors",
            classId,
            notes: "",
            minutes: 30,
            dueAt: null,
            deadlineConfirmed: true,
            resource: null,
          },
        })
        .tasks.at(-1)!.id;
    const t1 = make(a),
      t2 = make(b);
    const input = {
      title: "Vector notes",
      text: "  Original line\nα = 30°\n",
      classIds: [a, b, a],
      taskIds: [t1, t2],
    };
    assert.throws(() =>
      store.execute({
        type: "source.create",
        input: { ...input, taskIds: ["00000000-0000-4000-8000-000000000000"] },
      }),
    );
    assert.equal(store.snapshot().sources.length, 0);
    store.execute({ type: "source.create", input });
    store.close();
    store = new DeskStore(path);
    const source = store.snapshot().sources[0]!;
    assert.equal(source.text, input.text);
    assert.equal(source.authority, "user-provided-text");
    assert.equal(source.classIds.length, 2);
    assert.equal(source.taskIds.length, 2);
    store.execute({ type: "task.undo", id: t1 });
    assert.equal(store.snapshot().sources[0]!.text, input.text);
    assert.deepEqual(store.snapshot().sources[0]!.taskIds, [t2]);
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test("canvas revisions prevent stale overwrite and scenes persist separately from snapshots", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-board-"));
  const path = join(directory, "db.sqlite");
  let store = new DeskStore(path);
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    const taskId = store.execute({
      type: "task.create",
      input: {
        title: "Sketch",
        classId,
        dueAt: null,
        minutes: 30,
        deadlineConfirmed: true,
        resource: null,
        notes: "",
      },
    }).tasks[0]!.id;
    const board = store.execute({ type: "canvas.create", taskId }).canvases[0]!;
    const scene = {
      engine: "excalidraw" as const,
      version: 1 as const,
      elements: [
        {
          id: "ink",
          type: "freedraw" as const,
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          points: [
            [0, 0],
            [20, 20],
          ],
        },
      ],
      files: {},
      viewBackgroundColor: "#ffffff",
    };
    store.execute({ type: "canvas.save", id: board.id, revision: 0, scene });
    assert.throws(
      () =>
        store.execute({
          type: "canvas.save",
          id: board.id,
          revision: 0,
          scene: { ...scene, elements: [] },
        }),
      /changed elsewhere/,
    );
    assert.equal("scene" in store.snapshot().canvases[0]!, false);
    store.close();
    store = new DeskStore(path);
    assert.deepEqual(store.canvas(board.id).scene, scene);
    assert.equal(store.canvas(board.id).revision, 1);
    assert.throws(() => store.execute({ type: "task.undo", id: taskId }));
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});
