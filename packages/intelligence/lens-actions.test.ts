import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lensAnswerMemoryInput,
  lensAnswerSourceInput,
  lensFollowUpTaskInput,
} from "./lens-actions";

test("Lens answer memory action creates an explicit class-scoped note payload", () => {
  const result = lensAnswerMemoryInput(
    "The normal force balances the perpendicular component.",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.category, "other");
  assert.equal(result.classId, "00000000-0000-4000-8000-000000000001");
  assert.equal(result.text, "The normal force balances the perpendicular component.");
});

test("Lens answer action creates a user-linked source payload", () => {
  const result = lensAnswerSourceInput(
    "The normal force balances the perpendicular component.",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  );
  assert.equal(result.kind, "unspecified");
  assert.deepEqual(result.classIds, ["00000000-0000-4000-8000-000000000001"]);
  assert.deepEqual(result.taskIds, ["00000000-0000-4000-8000-000000000002"]);
  assert.equal(result.title, "Lens answer");
});

test("Lens follow-up action creates an explicit optional-review task payload", () => {
  const result = lensFollowUpTaskInput(
    "Review the sign of each component.",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(result.title, "Review Lens answer");
  assert.equal(result.workKind, "optional-review");
  assert.equal(result.minutes, 15);
  assert.equal(result.dueAt, null);
  assert.equal(result.notes, "Review the sign of each component.");
});
