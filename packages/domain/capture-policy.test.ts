import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";
const now = new Date("2026-09-06T12:00:00Z");
const complete =
  "English 12: Read chapter 3 due 2026-09-10T20:00:00Z, 30 minutes";
function capture(store: DeskStore, text: string) {
  return store.execute({ type: "inbox.capture", text, timeZone: "UTC" }, now);
}

test("Balanced auto-files complete literal evidence once and preserves review/undo and later work", () => {
  const store = new DeskStore(":memory:");
  try {
    store.execute({ type: "class.create", name: "English 12" });
    assert.equal(store.snapshot().capturePolicy, "balanced");
    let state = capture(store, `${complete}\n${complete}`);
    assert.equal(state.tasks.length, 1);
    assert.equal(state.captureInbox[0]!.status, "accepted");
    assert.equal(state.captureInbox[0]!.filing!.action, "auto-file");
    assert.equal(state.captureInbox[1]!.status, "pending");
    assert.match(state.captureInbox[1]!.filing!.reason, /already exists/);
    assert.equal(
      state.tasks[0]!.captureEvidence!.originalText,
      `${complete}\n${complete}`,
    );
    assert.ok(state.studyBlocks.length > 0);
    state = store.execute({ type: "task.undo", id: state.tasks[0]!.id }, now);
    assert.equal(state.captureInbox[0]!.status, "pending");
    assert.equal(state.studyBlocks.length, 0);
    state = capture(store, complete);
    const task = state.tasks[0]!;
    store.execute({
      type: "task.update",
      id: task.id,
      input: { ...task, notes: "New work" },
      deadlineChangeApproved: false,
    });
    assert.throws(
      () => store.execute({ type: "task.undo", id: task.id }),
      /edited/,
    );
    assert.equal(store.snapshot().tasks[0]!.notes, "New work");
  } finally {
    store.close();
  }
});

test("Conservative is durable; changing modes never retroactively accepts pending work", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-policy-"));
  let store = new DeskStore(join(dir, "desk.sqlite"));
  try {
    store.execute({ type: "class.create", name: "English 12" });
    store.execute({ type: "capture.policy", mode: "conservative" });
    const state = capture(store, complete);
    assert.equal(state.tasks.length, 0);
    store.close();
    store = new DeskStore(join(dir, "desk.sqlite"));
    assert.deepEqual(store.snapshot(), state);
    store.execute({ type: "capture.policy", mode: "autopilot" });
    assert.equal(store.snapshot().tasks.length, 0);
    assert.equal(
      store.snapshot().captureInbox[0]!.filing!.policy,
      "conservative",
    );
    store.execute({ type: "planning.mode", mode: "suggest" });
    const filed = capture(
      store,
      "English: Read chapter 4 due 2026-09-10T20:00:00Z, 30 minutes",
    );
    assert.equal(filed.tasks.length, 1);
    assert.equal(filed.studyBlocks.length, 0);
    assert.equal(filed.captureInbox.at(-1)!.draft.confidence.classId, "medium");
    assert.match(
      filed.captureInbox.at(-1)!.filing!.reason,
      /partial class match/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every mode keeps incomplete, ambiguous, risky-type and conflicting evidence for review", () => {
  for (const mode of ["balanced", "autopilot"] as const) {
    const store = new DeskStore(":memory:");
    try {
      store.execute({ type: "class.create", name: "English 12" });
      store.execute({ type: "class.create", name: "English 11" });
      store.execute({ type: "capture.policy", mode });
      for (const text of [
        "English: Read due 2026-09-10T20:00:00Z, 30 minutes",
        "English 12: Read tomorrow, 30 minutes",
        "English 12: Read due 2026-09-10, 30 minutes",
        "English 12: Read due 2026-09-10T20:00:00, 30 minutes",
        "English 12: Read due 2026-09-10T20:00:00Z",
        "English 12: Read due 2026-09-01T20:00:00Z, 30 minutes",
        "English 12: Quiz due 2026-09-10T20:00:00Z, 30 minutes",
        "English 12: Read due 2026-09-10T20:00:00Z, 30 minutes https://example.com/1 https://example.com/2",
      ])
        capture(store, text);
      assert.equal(store.snapshot().tasks.length, 0);
      assert.ok(
        store.snapshot().captureInbox.every((i) => i.status === "pending"),
      );
    } finally {
      store.close();
    }
  }
});
