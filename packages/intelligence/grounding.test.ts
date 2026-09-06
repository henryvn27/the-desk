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

test("Lens exposes due-date authority conflicts without choosing for the student", () => {
  const result = JSON.parse(
    lensContext({
      ...state,
      authorityClaims: [
        {
          id: "syllabus-claim",
          classId: "class",
          taskId: "task",
          fact: "due-date",
          value: "2026-09-09T23:00:00.000Z",
          authorityKind: "syllabus",
          confidence: "high",
          sourceLabel: "Syllabus",
          details: "Wednesday",
          sourceId: null,
          evidenceId: null,
          capturedAt: "2026-09-05T12:00:00.000Z",
          revision: 0,
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "lms-claim",
          classId: "class",
          taskId: "task",
          fact: "due-date",
          value: "2026-09-08T23:00:00.000Z",
          authorityKind: "live-lms",
          confidence: "medium",
          sourceLabel: "Classroom",
          details: "Tuesday",
          sourceId: null,
          evidenceId: null,
          capturedAt: "2026-09-05T13:00:00.000Z",
          revision: 0,
          createdAt: "",
          updatedAt: "",
        },
      ],
      authorityResolutions: [],
    } as unknown as Snapshot),
  );
  assert.deepEqual(
    result.authorityClaims.map((claim: { id: string }) => claim.id),
    ["lms-claim", "syllabus-claim"],
  );
  assert.equal(result.authorityConflict, true);
  assert.equal(result.authorityResolution, null);
});

test("explicit memory context includes global/current-class statements and discloses its budget", () => {
  const memories = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    text: "Preference ".repeat(100),
    category: "preference" as const,
    classId: i === 0 ? "other" : i === 1 ? null : "class",
    revision: 0,
    origin: "explicit" as const,
    createdAt: "",
    updatedAt: "",
  }));
  const result = JSON.parse(lensContext({ ...state, memories }));
  assert.ok(result.memories.length > 0);
  assert.ok(!result.memories.some((m: { id: string }) => m.id === "0"));
  assert.equal(result.memories.length + result.omittedMemories, 19);
  assert.ok(
    result.memories.every((m: { origin: string }) => m.origin === "explicit"),
  );
  assert.ok(JSON.stringify(result).length <= 20000);
});

test("unverifiable inferred memories are withheld while explicit notes remain available", () => {
  const base = {
    id: "memory",
    text: "Remember this",
    category: "preference" as const,
    classId: null,
    revision: 0,
    createdAt: "",
    updatedAt: "",
  };
  const result = JSON.parse(
    lensContext({
      ...state,
      inference: { enabled: true, excludedSessionIds: [] },
      memories: [
        { ...base, origin: "inferred" },
        { ...base, id: "explicit", origin: "explicit" },
      ],
    }),
  );
  assert.deepEqual(
    result.memories.map((memory: { id: string }) => memory.id),
    ["explicit"],
  );
});
