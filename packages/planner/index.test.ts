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

test("required work outranks optional review, and optional minutes are not required overload", () => {
  const result = plan(
    [
      {
        ...task("optional", 60, null),
        workKind: "optional-review",
        importance: "high",
      },
      { ...task("required", 60, null), importance: "low" },
    ],
    new Date("2026-09-07T08:00:00Z"),
    new Date("2026-09-07T09:00:00Z"),
    0,
  );
  assert.equal(result.blocks[0]!.taskId, "required");
  assert.equal(result.overloadMinutes, 0);
  assert.match(result.unscheduled[0]!.reason, /Optional review/);
});
test("imminent required deadlines precede higher importance and assessments", () => {
  const result = plan(
    [
      {
        ...task("assessment", 60, "2026-09-09T12:00:00Z"),
        workKind: "assessment",
        importance: "high",
      },
      { ...task("due", 60, "2026-09-07T09:00:00Z"), importance: "low" },
    ],
    new Date("2026-09-07T08:00:00Z"),
    new Date("2026-09-07T09:00:00Z"),
    0,
  );
  assert.equal(result.blocks[0]!.taskId, "due");
  assert.equal(result.overloadMinutes, 60);
});
test("recorded importance and assessment kind guide flexible work", () => {
  const result = plan(
    [
      task("normal", 30, null),
      { ...task("assessment", 30, null), workKind: "assessment" },
      { ...task("important", 30, null), importance: "high" },
    ],
    new Date("2026-09-07T08:00:00Z"),
    new Date("2026-09-07T10:00:00Z"),
    0,
  );
  assert.deepEqual(
    result.blocks.map((b) => b.taskId),
    ["important", "assessment", "normal"],
  );
  assert.match(result.blocks[0]!.why, /high importance/);
  assert.match(result.blocks[1]!.why, /Assessment preparation/);
});
test("linked assessments guide flexible work with an explicit explanation", () => {
  const result = plan(
    [task("unrelated", 30, null), task("prep", 30, null)],
    new Date("2026-09-07T08:00:00Z"),
    new Date("2026-09-07T09:00:00Z"),
    0,
    new Date("2026-09-07T09:00:00Z"),
    {
      gradeCategories: [],
      gradeEntries: [],
      assessments: [
        {
          id: "assessment",
          classId: "class",
          title: "Kinematics test",
          kind: "test",
          taskIds: ["prep"],
          dueAt: null,
          gradeCategoryId: null,
          notes: "",
          revision: 0,
          createdAt: "2026-09-05T12:00:00Z",
          updatedAt: "2026-09-05T12:00:00Z",
        },
      ],
    },
  );
  assert.equal(result.blocks[0]!.taskId, "prep");
  assert.match(result.blocks[0]!.why, /upcoming assessment/);
});

test("complete grade context can rank potential influence, but unknown work is not treated as zero", () => {
  const context = {
    gradeCategories: [
      { id: "large", classId: "class", name: "Tests", weight: 80, revision: 0 },
      { id: "small", classId: "class", name: "Work", weight: 20, revision: 0 },
    ],
    gradeEntries: [],
  };
  const a = {
    ...task("a", 30, null),
    gradeContext: { categoryId: "small", possiblePoints: 10 },
  };
  const b = {
    ...task("b", 30, null),
    gradeContext: { categoryId: "large", possiblePoints: 10 },
  };
  const start = new Date("2026-09-07T08:00:00Z"),
    end = new Date("2026-09-07T10:00:00Z");
  const complete = plan([a, b], start, end, 0, end, context);
  assert.deepEqual(
    complete.blocks.map((b) => b.taskId),
    ["b", "a"],
  );
  assert.match(
    complete.blocks[0]!.why,
    /potential influence, not predicted improvement/,
  );
  const incomplete = plan(
    [a, b, task("c", 30, null)],
    start,
    end,
    0,
    end,
    context,
  );
  assert.deepEqual(
    incomplete.blocks.map((b) => b.taskId),
    ["a", "b", "c"],
  );
});

test("earlier imminent deadlines remain ahead of later high-importance work", () => {
  const result = plan(
    [
      { ...task("later", 60, "2026-09-07T10:00:00Z"), importance: "high" },
      { ...task("early", 30, "2026-09-07T08:30:00Z"), importance: "low" },
    ],
    new Date("2026-09-07T08:00:00Z"),
    new Date("2026-09-07T10:00:00Z"),
    0,
  );
  assert.deepEqual(
    result.blocks.map((b) => b.taskId),
    ["early", "later"],
  );
  assert.equal(result.overloadMinutes, 0);
});
