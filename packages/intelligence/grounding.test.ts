import { test } from "node:test";
import assert from "node:assert/strict";
import type { Snapshot, Source } from "../domain/contracts";
import { lensContext } from "./grounding";
const source = (
  id: string,
  taskIds: string[],
  classIds: string[],
  text = "Material",
): Source => ({
  id,
  title: id,
  taskIds,
  classIds,
  text,
  authority: "user-provided-text",
  createdAt: "2026-09-06",
});
const state = {
  sessions: [{ taskId: "task", endedAt: null }],
  tasks: [
    {
      id: "task",
      classId: "class",
      title: "Assignment",
      notes: "",
      resource: null,
    },
  ],
  classes: [{ id: "class", name: "Physics" }],
  sources: [
    source("class-wide", [], ["class"]),
    source("task-linked", ["task"], []),
    source("other-task", ["other"], ["class"]),
    source("other-class", [], ["other"]),
  ],
} as unknown as Snapshot;
test("Lens grounds only active task and class-wide sources with honest provenance", () => {
  const result = JSON.parse(lensContext(state));
  assert.deepEqual(
    result.sources.map((s: Source) => s.id),
    ["task-linked", "class-wide"],
  );
  assert.equal(result.sources[0].authority, "user-provided-text");
  assert.equal(result.resourceFetched, false);
  assert.equal(result.omittedSources, 0);
  assert.match(
    lensContext({ ...state, sessions: [] }),
    /No active academic session/,
  );
});
test("Grounding respects serialized request budget and discloses exclusions", () => {
  const sources = Array.from({ length: 30 }, (_, i) =>
    source(String(i).padStart(2, "0"), ["task"], [], '"\\\n'.repeat(5000)),
  );
  const text = lensContext({ ...state, sources });
  const result = JSON.parse(text);
  assert.ok(text.length <= 20000);
  assert.ok(result.sources.length > 0);
  assert.ok(result.sources.every((s: { truncated: boolean }) => s.truncated));
  assert.equal(result.sources.length + result.omittedSources, 30);
});

test("reported source hierarchy precedes association priority without upgrading provenance", () => {
  const sources = [
    { ...source("web", ["task"], []), kind: "general-web" as const },
    { ...source("book", ["task"], []), kind: "assigned-textbook" as const },
    { ...source("teacher", [], ["class"]), kind: "class-material" as const },
    {
      ...source("reference", ["task"], []),
      kind: "educational-reference" as const,
    },
    source("unknown", ["task"], []),
  ];
  const result = JSON.parse(lensContext({ ...state, sources }));
  assert.deepEqual(
    result.sources.map((s: { id: string }) => s.id),
    ["teacher", "book", "reference", "web", "unknown"],
  );
  assert.ok(
    result.sources.every(
      (s: { authority: string; kindReportedBy: string }) =>
        s.authority === "user-provided-text" && s.kindReportedBy === "user",
    ),
  );
});

test("within one reported source type lexical coverage precedes task association", () => {
  const sources = [
    source("task-linked", ["task"], [], "Generic notes"),
    source(
      "class-wide",
      [],
      ["class"],
      "Static friction depends on normal force.",
    ),
  ];
  const result = JSON.parse(
    lensContext({ ...state, sources }, "static friction normal force"),
  );
  assert.deepEqual(
    result.sources.map((s: { id: string }) => s.id),
    ["class-wide", "task-linked"],
  );
  assert.equal(result.sources[1].selectionMethod, "opening-fallback");
});
