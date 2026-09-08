import { test } from "node:test";
import assert from "node:assert/strict";
import { DeskStore } from "../domain/store";
import { deriveHome } from "../planner/home";
import { deriveDeskIntelligence } from "./desk-intelligence";
import {
  deadlinePeriodItems,
  deriveChatSuggestions,
  formatUpcoming,
  resolveChat,
} from "./chat";

const now = new Date("2026-09-07T12:00:00.000Z");

function createProfile(store: DeskStore) {
  store.execute({
    type: "user.create",
    input: { displayName: "Student", email: null, timeZone: "America/New_York" },
  });
}

test("literal deadline intent is independent from curated Home upcoming", () => {
  const store = new DeskStore(":memory:");
  try {
    createProfile(store);
    const classId = store.execute({ type: "class.create", name: "Calculus" }).classes[0]!.id;
    const task = store.execute({
      type: "task.create",
      input: {
        title: "Short derivatives review",
        classId,
        dueAt: "2026-09-10T02:30:00.000Z",
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    const snapshot = store.snapshot();
    const intelligence = deriveDeskIntelligence(snapshot, now);
    assert.equal(deriveHome(snapshot, now).upcoming.length, 0);
    const due = resolveChat(snapshot, intelligence, { question: "What's due this week?" }, now);
    assert.equal(due?.artifact?.kind, "upcoming");
    assert.deepEqual(
      due?.artifact?.kind === "upcoming" ? due.artifact.items.map((item) => item.taskId) : [],
      [task.id],
    );
    assert.ok(deriveChatSuggestions(snapshot, intelligence, now).includes("What’s due this week?"));
    assert.equal(resolveChat(snapshot, intelligence, { question: "What's next?" }, now)?.artifact?.kind, "next");
    const curated = resolveChat(snapshot, intelligence, { question: "What is upcoming?" }, now);
    assert.match(curated?.text ?? "", /curated for attention/i);
  } finally {
    store.close();
  }
});

test("deadline period and presentation use the persisted profile timezone", () => {
  const store = new DeskStore(":memory:");
  try {
    createProfile(store);
    const classId = store.execute({ type: "class.create", name: "Calculus" }).classes[0]!.id;
    const included = store.execute({
      type: "task.create",
      input: {
        title: "Near midnight review",
        classId,
        dueAt: "2026-09-08T01:30:00.000Z",
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!;
    store.execute({
      type: "task.create",
      input: {
        title: "Outside the period",
        classId,
        dueAt: "2026-09-16T02:00:00.000Z",
        minutes: 30,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const snapshot = store.snapshot();
    const period = deadlinePeriodItems(snapshot, now);
    assert.equal(period.timeZone, "America/New_York");
    assert.deepEqual(period.items.map((item) => item.taskId), [included.id]);
    assert.match(formatUpcoming(period.items[0]!, period.timeZone), /Mon, Sep 7/);
    assert.match(formatUpcoming(period.items[0]!, "UTC"), /Tue, Sep 8/);
  } finally {
    store.close();
  }
});
