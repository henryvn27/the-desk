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

test("saved study window respects local start, cutoff, off-days and DST", async () => {
  const { todayWindow } = await import("./index");
  const { defaultPlanningPreferences } = await import("../domain/contracts");
  const oldZone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const prefs = {
      ...defaultPlanningPreferences,
      studyStart: "16:00",
      sleepCutoff: "21:30",
    };
    const morning = todayWindow(new Date("2026-09-05T10:00:00-04:00"), prefs);
    assert.equal(morning.start.toISOString(), "2026-09-05T20:00:00.000Z");
    assert.equal(morning.end.toISOString(), "2026-09-06T01:30:00.000Z");
    const late = todayWindow(new Date("2026-09-05T23:00:00-04:00"), prefs);
    assert.equal(+late.start, +late.end);
    const off = todayWindow(new Date("2026-09-05T17:00:00-04:00"), {
      ...prefs,
      studyDays: [],
    });
    assert.equal(+off.start, +off.end);
    const spring = todayWindow(new Date("2026-03-08T00:00:00-05:00"), {
      ...prefs,
      studyStart: "01:00",
      sleepCutoff: "04:00",
    });
    assert.equal((+spring.end - +spring.start) / 3600000, 2);
    const fall = todayWindow(new Date("2026-11-01T00:00:00-04:00"), {
      ...prefs,
      studyStart: "01:00",
      sleepCutoff: "04:00",
    });
    assert.equal((+fall.end - +fall.start) / 3600000, 4);
    assert.throws(
      () => todayWindow(new Date(), { ...prefs, studyStart: "23:00" }),
      /before/,
    );
  } finally {
    if (oldZone === undefined) delete process.env.TZ;
    else process.env.TZ = oldZone;
  }
});
