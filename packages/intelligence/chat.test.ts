import { test } from "node:test";
import assert from "node:assert/strict";
import { DeskStore } from "../domain/store";
import { deriveDeskIntelligence } from "./desk-intelligence";
import { deriveChatSuggestions, resolveChat } from "./chat";

const now = new Date("2026-09-07T12:00:00.000Z");

test("chat delegates next-work questions to the canonical next action", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "AP Physics C" }).classes[0]!.id;
    const taskId = store.execute({
      type: "task.create",
      input: {
        title: "Forces problem set",
        classId,
        dueAt: "2026-09-08T23:00:00.000Z",
        minutes: 45,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    }).tasks[0]!.id;
    const snapshot = store.snapshot();
    const intelligence = deriveDeskIntelligence(snapshot, now);
    const response = resolveChat(snapshot, intelligence, { question: "What should I do now?" }, now);
    assert.equal(response?.kind, "deterministic");
    assert.equal(response?.action?.type, "start-session");
    assert.equal(response?.action?.taskId, taskId);
    assert.equal(response?.artifact?.kind, "next");
  } finally {
    store.close();
  }
});

test("chat returns bounded deadline and time-plan artifacts without mutating state", () => {
  const store = new DeskStore(":memory:");
  try {
    const classId = store.execute({ type: "class.create", name: "Calculus" }).classes[0]!.id;
    store.execute({
      type: "task.create",
      input: {
        title: "Derivatives worksheet",
        classId,
        dueAt: "2026-09-10T23:00:00.000Z",
        minutes: 100,
        resource: null,
        notes: "",
        deadlineConfirmed: true,
      },
    });
    const snapshot = store.snapshot();
    const intelligence = deriveDeskIntelligence(snapshot, now);
    const upcoming = resolveChat(snapshot, intelligence, { question: "What's due this week?" }, now);
    assert.equal(upcoming?.artifact?.kind, "upcoming");
    const before = store.snapshot().tasks.length;
    const time = resolveChat(snapshot, intelligence, { question: "I have 25 minutes" }, now);
    assert.equal(time?.artifact?.kind, "time-plan");
    assert.equal(store.snapshot().tasks.length, before);
  } finally {
    store.close();
  }
});

test("chat suggestions stay short and context-aware", () => {
  const store = new DeskStore(":memory:");
  try {
    const snapshot = store.snapshot();
    const intelligence = deriveDeskIntelligence(snapshot, now);
    const suggestions = deriveChatSuggestions(snapshot, intelligence, now);
    assert.ok(suggestions.length >= 1 && suggestions.length <= 4);
    assert.ok(suggestions.some((suggestion) => /what should i do/i.test(suggestion)));
  } finally {
    store.close();
  }
});

test("unknown chat questions do not produce an implicit command", () => {
  const store = new DeskStore(":memory:");
  try {
    const snapshot = store.snapshot();
    const intelligence = deriveDeskIntelligence(snapshot, now);
    const response = resolveChat(snapshot, intelligence, { question: "Tell me something surprising about this semester." }, now);
    assert.equal(response, null);
  } finally {
    store.close();
  }
});
