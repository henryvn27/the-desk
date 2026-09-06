import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import { plan } from "../planner";

const input = (classId: string, taskIds: string[], name = "Kinematics") => ({
  classId,
  taskIds,
  name,
  status: "learning" as const,
  preparedness: "not-ready" as const,
  retentionMode: "long-term" as const,
  reviewDue: null,
  attempts: 3,
  unaidedCorrect: 1,
  unaidedTotal: 2,
  hintCount: 1,
  lastReviewedAt: "2026-09-05T12:00:00.000Z",
  evidenceNote: "Can set up the model with a prompt.",
});

test("concepts persist evidence, enforce links and revisions, influence planning, and can be forgotten", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-concepts-"));
  const path = join(directory, "desk.sqlite");
  let store = new DeskStore(path);
  try {
    const first = store.execute({ type: "class.create", name: "Physics" });
    const second = store.execute({ type: "class.create", name: "History" });
    const firstClassId = first.classes[0]!.id;
    const secondClassId = second.classes.at(-1)!.id;
    const linkedTask = store
      .execute({
        type: "task.create",
        input: {
          title: "Kinematics practice",
          classId: firstClassId,
          dueAt: "2026-09-08T23:00:00.000Z",
          minutes: 20,
          resource: null,
          notes: "",
          deadlineConfirmed: true,
        },
      })
      .tasks.at(-1)!;
    const otherTask = store
      .execute({
        type: "task.create",
        input: {
          title: "History reading",
          classId: secondClassId,
          dueAt: "2026-09-08T23:00:00.000Z",
          minutes: 20,
          resource: null,
          notes: "",
          deadlineConfirmed: true,
        },
      })
      .tasks.at(-1)!;
    const created = store.execute({
      type: "concept.create",
      input: input(firstClassId, [linkedTask.id]),
    }).concepts[0]!;
    assert.equal(created.revision, 0);
    assert.equal(created.taskIds[0], linkedTask.id);
    assert.throws(
      () =>
        store.execute({
          type: "concept.create",
          input: input(firstClassId, [linkedTask.id], "kinematics"),
        }),
      /already exists/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "concept.create",
          input: input(firstClassId, [otherTask.id], "History link"),
        }),
      /linked task must belong/,
    );
    assert.throws(
      () =>
        store.execute({
          type: "concept.update",
          id: created.id,
          revision: 4,
          input: input(firstClassId, [linkedTask.id]),
        }),
      /changed elsewhere/,
    );
    const updated = store.execute({
      type: "concept.update",
      id: created.id,
      revision: created.revision,
      input: {
        ...input(firstClassId, [linkedTask.id]),
        preparedness: "developing",
        evidenceNote: "Unaided setup is improving.",
      },
    }).concepts[0]!;
    assert.equal(updated.revision, 1);
    assert.equal(updated.evidenceNote, "Unaided setup is improving.");
    const planned = plan(
      [
        linkedTask,
        {
          ...linkedTask,
          id: "00000000-0000-4000-8000-000000000099",
          title: "Unlinked review",
        },
      ],
      new Date("2026-09-05T08:00:00.000Z"),
      new Date("2026-09-05T09:00:00.000Z"),
      0,
      new Date("2026-09-08T23:00:00.000Z"),
      store.snapshot(),
    );
    assert.equal(planned.blocks[0]!.taskId, linkedTask.id);
    assert.match(planned.blocks[0]!.why, /concept needs review/);
    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().concepts[0]!.revision, 1);
    const forgotten = store.execute({
      type: "concept.forget",
      id: store.snapshot().concepts[0]!.id,
      revision: store.snapshot().concepts[0]!.revision,
    });
    assert.equal(forgotten.concepts.length, 0);
    assert.equal(forgotten.tasks.length, 2);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concept evidence rejects impossible unaided totals", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!.id;
    assert.throws(
      () =>
        store.execute({
          type: "concept.create",
          input: { ...input(classId, []), unaidedCorrect: 3, unaidedTotal: 2 },
        }),
      /Unaided correct cannot exceed/,
    );
  } finally {
    store.close();
  }
});
