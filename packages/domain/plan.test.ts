import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeskStore } from "./store";

test("committed auto-plan and rebalance results persist as Plan versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "desk-plan-"));
  const path = join(directory, "desk.sqlite");
  const now = new Date("2026-09-06T12:00:00.000Z");
  let store = new DeskStore(path);
  try {
    const course = store.execute({ type: "class.create", name: "Physics" })
      .classes[0]!;
    let snapshot = store.execute(
      {
        type: "task.create",
        input: {
          title: "Kinematics set",
          classId: course.id,
          dueAt: "2026-09-08T23:00:00.000Z",
          minutes: 45,
          resource: null,
          notes: "",
          deadlineConfirmed: true,
        },
      },
      now,
    );
    assert.equal(snapshot.plans.length, 1);
    assert.equal(snapshot.plans[0]!.trigger, "auto-plan");
    assert.equal(snapshot.plans[0]!.authority, "computed");
    assert.deepEqual(
      snapshot.plans[0]!.blockIds,
      snapshot.studyBlocks
        .filter((block) => !block.cancelledAt)
        .map((b) => b.id),
    );
    assert.equal(snapshot.plans[0]!.basisHash.length, 64);

    store.close();
    store = new DeskStore(path);
    assert.equal(store.snapshot().plans.length, 1);
    const preview = store.previewRebalance(now);
    snapshot = store.execute(
      { type: "planning.rebalance", previewId: preview.id, approved: true },
      now,
    );
    assert.equal(snapshot.plans.length, 2);
    assert.equal(snapshot.plans[0]!.trigger, "rebalance");
    assert.equal(snapshot.planChanges.length, 2);
    assert.equal(
      snapshot.plans[0]!.blockIds.length,
      snapshot.studyBlocks.filter((b) => !b.cancelledAt).length,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
