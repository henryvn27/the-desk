import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../domain/contracts";
import { metadataForMistake, validateDeterministicAnswer, validatePracticeCandidate } from "./practice";

const mistake = {
  id: "mistake-1",
  classId: "class-1",
  taskId: null,
  concept: "Sign convention",
  source: "Worksheet",
  originalAttempt: "I used positive for downward.",
  whatWentWrong: "The chosen axis was upward.",
  correction: "Set the axis before assigning signs.",
  helpUsed: "Teacher",
  confidence: "medium" as const,
  reviewDue: null,
  practiceTaskIds: [],
  revision: 0,
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};
const task = (practice: ReturnType<typeof metadataForMistake>): Task => ({
  id: "practice-1",
  title: "Practice: Sign convention",
  classId: "class-1",
  dueAt: null,
  minutes: 20,
  resource: null,
  notes: "Practice generated from mistake mistake-1.\n\nCorrection: Set the axis before assigning signs.\nWhat went wrong: The chosen axis was upward.",
  practice,
  deadlineConfirmed: true,
  completed: false,
  revision: 0,
  createdAt: "2026-09-06T12:00:00.000Z",
});

test("free-form mistake practice is preserved but explicitly requires manual checking", () => {
  const metadata = metadataForMistake(mistake);
  assert.equal(metadata.answerValidation, "manual-review");
  const quality = validatePracticeCandidate(task(metadata), []);
  assert.equal(quality.accepted, true);
  assert.equal(quality.checks.answerValidated, true);
  assert.match(metadata.validatorNotes, /machine-checkable answer/);
});

test("identical practice candidates are rejected while a thin or ambiguous candidate is not accepted", () => {
  const metadata = metadataForMistake(mistake);
  const candidate = task(metadata);
  const duplicate = validatePracticeCandidate(candidate, [candidate]);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.checks.duplicate, true);
  const thin = validatePracticeCandidate({ title: "Practice", notes: "Correction: x", practice: metadata }, []);
  assert.equal(thin.accepted, false);
  assert.ok(thin.issues.length > 0);
  const ambiguous = validatePracticeCandidate({ title: candidate.title, notes: `${candidate.notes} Maybe use another method.`, practice: metadata }, []);
  assert.equal(ambiguous.accepted, false);
});

test("deterministic practice validation checks units before numeric equality", () => {
  assert.equal(validateDeterministicAnswer({ expected: 15, actual: 15, expectedUnit: "N", actualUnit: "N" }).valid, true);
  assert.equal(validateDeterministicAnswer({ expected: 15, actual: 15, expectedUnit: "N", actualUnit: "kg" }).valid, false);
  assert.equal(validateDeterministicAnswer({ expected: 15, actual: 14.5, expectedUnit: "N", actualUnit: "N" }).valid, false);
});
