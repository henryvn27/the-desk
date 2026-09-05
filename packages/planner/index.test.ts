import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "./index";
import type { Task } from "../domain/contracts";
const task = (
  id: string,
  minutes: number,
  dueAt: string | null = "2026-09-06T23:00:00Z",
): Task => ({
  id,
  title: id,
  classId: "class",
  minutes,
  dueAt,
  resource: null,
  notes: "",
  deadlineConfirmed: true,
  completed: false,
  createdAt: "2026-09-05T12:00:00Z",
});
test("overload preserves required work and leaves capacity buffer", () => {
  const result = plan(
    [task("a", 100), task("b", 120)],
    new Date("2026-09-05T18:00:00Z"),
    new Date("2026-09-05T20:10:00Z"),
  );
  assert.equal(
    result.blocks.reduce((s, b) => s + b.minutes, 0),
    100,
  );
  assert.equal(result.overloadMinutes, 120);
  assert.ok(
    result.blocks.every(
      (b) => Date.parse(b.end) <= Date.parse("2026-09-05T20:10:00Z"),
    ),
  );
});
test("uncertain dates and past deadlines are never silently scheduled", () => {
  const result = plan(
    [
      { ...task("a", 30), deadlineConfirmed: false },
      task("b", 30, "2026-09-04T12:00:00Z"),
    ],
    new Date("2026-09-05T18:00:00Z"),
    new Date("2026-09-05T20:00:00Z"),
  );
  assert.equal(result.blocks.length, 0);
  assert.equal(result.unscheduled.length, 2);
});
test("completed work leaves the next plan and no capacity means no blocks", () => {
  assert.equal(
    plan([{ ...task("a", 30), completed: true }], new Date(), new Date()).blocks
      .length,
    0,
  );
  const at = new Date();
  assert.equal(plan([task("a", 30, null)], at, at).overloadMinutes, 30);
});
