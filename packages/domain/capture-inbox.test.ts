import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
import type { TaskInput } from "./contracts";

test("uncertain batch remains durable and unplanned until atomic review; undo returns its source to inbox", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-inbox-"));
  let store = new DeskStore(join(dir, "desk.sqlite"));
  try {
    const course = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    const original = "  - Physics: Forces due tomorrow\n- Read chapter 3\n";
    let state = store.execute(
      { type: "inbox.capture", text: original, timeZone: "America/New_York" },
      new Date("2026-09-06T12:00:00Z"),
    );
    assert.equal(state.captureInbox.length, 2);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.studyBlocks.length, 0);
    assert.ok(state.captureInbox[0]!.draft.uncertainties.length);
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot(), state);
    const item = state.captureInbox[0]!;
    const input: TaskInput = {
      title: "Forces",
      classId: course.id,
      minutes: 30,
      dueAt: "2026-09-10T20:00:00Z",
      deadlineConfirmed: true,
      notes: "Reviewed",
      resource: null,
    };
    assert.throws(
      () =>
        store.execute({
          type: "inbox.accept",
          id: item.id,
          revision: 5,
          input,
        }),
      /changed/,
    );
    assert.deepEqual(store.snapshot(), state);
    assert.throws(() =>
      store.execute({
        type: "inbox.accept",
        id: item.id,
        revision: 0,
        input: { ...input, classId: "00000000-0000-4000-8000-000000000000" },
      }),
    );
    assert.deepEqual(store.snapshot(), state);
    state = store.execute(
      { type: "inbox.accept", id: item.id, revision: 0, input },
      new Date("2026-09-06T12:00:00Z"),
    );
    assert.equal(state.tasks.length, 1);
    assert.ok(state.studyBlocks.length > 0);
    assert.equal(state.tasks[0]!.captureEvidence!.originalText, original);
    assert.equal(state.captureInbox[0]!.taskId, state.tasks[0]!.id);
    assert.equal(state.captureInbox[0]!.status, "accepted");
    assert.throws(
      () =>
        store.execute({
          type: "inbox.accept",
          id: item.id,
          revision: 0,
          input,
        }),
      /changed/,
    );
    state = store.execute({ type: "task.undo", id: state.tasks[0]!.id });
    assert.equal(state.captureInbox[0]!.status, "pending");
    assert.equal(state.captureInbox[0]!.revision, 2);
    assert.equal(state.tasks.length, 0);
    assert.equal(state.studyBlocks.length, 0);
    assert.equal(
      state.captureInbox[0]!.draft.provenance.originalText,
      original,
    );
    state = store.execute({
      type: "inbox.archive",
      id: item.id,
      revision: 2,
      archived: true,
    });
    assert.equal(state.captureInbox[0]!.status, "archived");
    assert.throws(
      () =>
        store.execute({
          type: "inbox.accept",
          id: item.id,
          revision: 3,
          input,
        }),
      /changed/,
    );
    state = store.execute({
      type: "inbox.archive",
      id: item.id,
      revision: 3,
      archived: false,
    });
    assert.equal(state.captureInbox[0]!.status, "pending");
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot(), state);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid zone and oversized batches roll back without partial inbox items", () => {
  const store = new DeskStore(":memory:");
  try {
    const before = store.snapshot();
    assert.throws(() =>
      store.execute({
        type: "inbox.capture",
        text: "Read chapter",
        timeZone: "Unknown/Zone",
      }),
    );
    assert.throws(() =>
      store.execute({
        type: "inbox.capture",
        text: Array.from({ length: 51 }, (_, i) => `- Read chapter ${i}`).join(
          "\n",
        ),
        timeZone: "UTC",
      }),
    );
    assert.deepEqual(store.snapshot(), before);
  } finally {
    store.close();
  }
});
