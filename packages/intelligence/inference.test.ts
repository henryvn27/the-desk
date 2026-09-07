import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyProviderPatch,
  inferAcademic,
  inferenceFingerprint,
  mergeInferenceIntoCaptureDraft,
  reconcileTaskInference,
  shouldEscalateInference,
} from "./inference";
import type { CaptureDraft } from "./capture";
import type { Task } from "../domain/contracts";

const classes = [
  { id: "physics", name: "AP Physics C", color: "#50705A" },
  { id: "calculus", name: "AP Calculus BC", color: "#9D5540" },
];
const now = new Date("2026-09-07T12:00:00.000Z");

test("universal inference keeps field-level evidence and never invents a deadline", () => {
  const result = inferAcademic(
    {
      sourceKind: "capture",
      title: "Physics homework",
      text: "AP Physics C\nUnit: Forces\nProblem set 4 due Wednesday\nConcept: friction and Newton's laws",
      capturedAt: now.toISOString(),
    },
    { classes, now, timeZone: "America/New_York" },
  );
  assert.equal(result.fields.objectType.value, "assignment");
  assert.equal(result.fields.classId.value, "physics");
  assert.equal(result.fields.unit.value, "Forces");
  assert.deepEqual(result.fields.concepts.value, ["Forces", "friction and Newton's laws"]);
  assert.equal(result.fields.dueAt.value, null);
  assert.equal(result.fields.dueAt.confidence, "medium");
  assert.equal(result.needsReview, true);
  assert.equal(result.fields.classId.provenance[0]?.sourceKind, "capture");
  assert.equal(result.fields.classId.inferenceVersion, "desk-inference-v1");
  assert.equal(shouldEscalateInference(result), true);
  assert.equal(inferenceFingerprint(result).length, 64);
});

test("ambiguous class routing is preserved until a user or model resolves it", () => {
  const result = inferAcademic(
    { sourceKind: "browser", text: "Math homework: review the chapter 3 problems by Friday." },
    { classes: [{ id: "a", name: "Math", color: "#000" }, { id: "b", name: "Math", color: "#111" }], now, timeZone: "UTC" },
  );
  assert.equal(result.fields.classId.value, null);
  assert.equal(result.conflicts[0]?.field, "classId");
  assert.equal(result.needsReview, true);
  const patched = applyProviderPatch(result, { className: "Math" }, { sourceKind: "browser", text: "Math homework: review the chapter 3 problems by Friday." }, [{ id: "a", name: "Math A", color: "#000" }], "openai/gpt-5.6-luna");
  assert.equal(patched.fields.classId.value, "a");
  assert.equal(patched.fields.classId.confidence, "medium");
  assert.equal(patched.provider?.model, "openai/gpt-5.6-luna");
});

test("provider suggestions enrich a capture draft without making it auto-fileable", () => {
  const draft: CaptureDraft = {
    title: "",
    classId: null,
    objectType: "unknown",
    deadline: null,
    minutes: null,
    resources: [],
    confidence: { title: "low", classId: "low", deadline: "low", minutes: "low", resources: "low", objectType: "low" },
    uncertainties: [{ field: "classId", message: "Choose a class." }],
    provenance: { source: "pasted-text", capturedAt: now.toISOString(), originalText: "", sourceText: "", authority: "user-provided-text", lineNumber: null },
  };
  const result = applyProviderPatch(
    inferAcademic({ sourceKind: "capture", text: "Homework" }, { classes, now, timeZone: "UTC" }),
    { title: "Forces problem set", className: "AP Physics C", dueAt: "2026-09-10T23:00:00.000Z", objectType: "assignment" },
    { sourceKind: "capture", text: "Homework" },
    classes,
    "openai/gpt-5.6-luna",
  );
  const merged = mergeInferenceIntoCaptureDraft(draft, result);
  assert.equal(merged.title, "Homework");
  assert.equal(merged.classId, "physics");
  assert.equal(merged.deadline?.instant, "2026-09-10T23:00:00.000Z");
  assert.equal(merged.deadline?.requiresConfirmation, true);
  assert.ok(merged.uncertainties.some((item) => /confirm/i.test(item.message)));
});

test("reconciliation proposes only empty task fields and reports review work", () => {
  const task = {
    id: "task",
    title: "Existing title",
    classId: "physics",
    dueAt: null,
    minutes: 30,
    resource: null,
    notes: "",
    deadlineConfirmed: false,
    completed: false,
    createdAt: now.toISOString(),
  } satisfies Task;
  const result = inferAcademic({ sourceKind: "source", text: "AP Physics C\nDue 2026-09-10T23:00:00Z\nhttps://example.com" }, { classes, now, timeZone: "UTC" });
  const reconciled = reconcileTaskInference(task, result);
  assert.equal(reconciled.proposed.title, undefined);
  assert.equal(reconciled.proposed.classId, undefined);
  assert.equal(reconciled.proposed.dueAt, "2026-09-10T23:00:00.000Z");
  assert.equal(reconciled.proposed.resource, "https://example.com");
  assert.equal(reconciled.requiresReview, true);
});
