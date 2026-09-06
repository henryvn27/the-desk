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

test("weekly plan carries remaining work across study days without duplication or late blocks", async () => {
  const { planWeek } = await import("./index");
  const now = new Date(2026, 8, 5, 8, 0); // local Saturday
  const prefs = {
    studyStart: "09:00",
    sleepCutoff: "10:00",
    studyDays: [0, 1, 2, 3, 4, 5, 6],
    bufferPercent: 15,
  };
  const due = new Date(2026, 8, 7, 10, 0).toISOString();
  const input = [
    task("long", 130, due),
    task("overflow", 80, due),
    { ...task("uncertain", 30, due), deadlineConfirmed: false },
  ];
  const result = planWeek(input, now, prefs);
  assert.equal(
    result.blocks
      .filter((b) => b.taskId === "long")
      .reduce((sum, b) => sum + b.minutes, 0),
    130,
  );
  for (const t of input)
    assert.equal(
      result.blocks
        .filter((b) => b.taskId === t.id)
        .reduce((sum, b) => sum + b.minutes, 0) +
        (result.unscheduled.find((u) => u.taskId === t.id)?.minutes ?? 0),
      t.minutes,
    );
  assert.equal(input[0]!.minutes, 130);
  assert.ok(result.blocks.every((b) => Date.parse(b.end) <= Date.parse(due)));
  assert.equal(
    new Set(
      result.blocks
        .filter((b) => b.taskId === "long")
        .map((b) => new Date(b.start).getDate()),
    ).size,
    3,
  );
  const off = planWeek([task("future", 30, null)], now, {
    ...prefs,
    studyDays: [1],
  });
  assert.equal(new Date(off.blocks[0]!.start).getDay(), 1);
  assert.equal(off.unscheduled.length, 0);
  const noDays = planWeek([task("future", 30, null)], now, {
    ...prefs,
    studyDays: [],
  });
  assert.equal(noDays.blocks.length, 0);
  assert.equal(noDays.overloadMinutes, 30);
});

test("saved commitments reserve capacity once, preserve locks, and elapsed blocks do not imply completion", async () => {
  const { planWeek } = await import("./index");
  const { defaultPlanningPreferences } = await import("../domain/contracts");
  const now = new Date(2026, 8, 7, 8, 0, 0);
  const start = new Date(2026, 8, 7, 9, 0, 0).toISOString();
  const end = new Date(2026, 8, 7, 10, 0, 0).toISOString();
  const saved = {
    id: "block",
    taskId: "a",
    start,
    end,
    minutes: 60,
    why: "Reserved",
    locked: true,
    revision: 2,
    createdAt: start,
    updatedAt: start,
  };
  const original = structuredClone(saved);
  const result = planWeek(
    [task("a", 90, null), task("b", 120, null)],
    now,
    {
      ...defaultPlanningPreferences,
      studyStart: "08:00",
      sleepCutoff: "12:00",
      studyDays: [1],
      bufferPercent: 25,
    },
    [saved],
  );
  assert.equal(
    result.blocks
      .filter((b) => b.taskId === "a")
      .reduce((s, b) => s + b.minutes, 0),
    30,
  );
  assert.equal(
    result.blocks.reduce((s, b) => s + b.minutes, 0),
    120,
  );
  assert.equal(result.overloadMinutes, 30);
  assert.ok(
    result.blocks.every(
      (b) =>
        Date.parse(b.end) <= Date.parse(start) ||
        Date.parse(b.start) >= Date.parse(end),
    ),
  );
  assert.deepEqual(saved, original);
  const nextWeek = planWeek(
    [task("a", 90, null)],
    new Date(2026, 8, 14, 8),
    defaultPlanningPreferences,
    [saved],
  );
  assert.equal(
    nextWeek.blocks.reduce((s, b) => s + b.minutes, 0),
    90,
  );
});

test("cancelled reservations restore the full remaining workload", async () => {
  const { planWeek } = await import("./index");
  const { defaultPlanningPreferences } = await import("../domain/contracts");
  const start = new Date(2026, 8, 7, 9).toISOString();
  const end = new Date(2026, 8, 7, 10).toISOString();
  const result = planWeek(
    [task("a", 90, null)],
    new Date(2026, 8, 7, 8),
    defaultPlanningPreferences,
    [
      {
        id: "cancelled",
        taskId: "a",
        start,
        end,
        minutes: 60,
        why: "Reserved",
        locked: true,
        revision: 3,
        createdAt: start,
        updatedAt: start,
        cancelledAt: start,
      },
    ],
  );
  assert.equal(
    result.blocks.reduce((sum, b) => sum + b.minutes, 0),
    90,
  );
  assert.equal(result.blocks[0]!.start, new Date(2026, 8, 7, 8).toISOString());
});
