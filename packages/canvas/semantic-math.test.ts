import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExpressions } from "./semantic-math";

test("semantic math evaluates dependent, unit-aware STEM expressions deterministically", () => {
  const result = evaluateExpressions(["m = 5 kg", "a = 3 m/s^2", "F = ma"]);
  const force = result.values.at(-1)!;
  assert.equal(force.value, 15);
  assert.match(force.display, /15\s*N/);
  assert.deepEqual(force.dependencies.sort(), ["a", "m"]);
});

test("unsafe or malformed expressions do not execute and report no result", () => {
  const result = evaluateExpressions(["x = 2", "import('node:fs')"]);
  assert.equal(result.values.length, 1);
  assert.equal(result.values[0]!.name, "x");
});
