import assert from "node:assert/strict";
import { test } from "node:test";
import { lensAnswerSourceInput } from "./lens-actions";

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
