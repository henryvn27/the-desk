import { test } from "node:test";
import assert from "node:assert/strict";
import { benchmarkPlanner, comparePlannerBenchmarks, plannerBenchmarkScenarios } from "./evaluation";

test("planner benchmark covers the required adversarial scenario families", () => {
  const scenarios = plannerBenchmarkScenarios();
  assert.equal(scenarios.length, 12);
  assert.deepEqual(new Set(scenarios.map((scenario) => scenario.family)).size, 12);
});

test("planner benchmark is deterministic and exposes explainability and invariants", () => {
  const first = benchmarkPlanner();
  const second = benchmarkPlanner();
  assert.deepEqual(first, second);
  assert.equal(first.metrics.overloadTransparencyRate, 1);
  assert.equal(first.metrics.bufferPreservationRate, 1);
  assert.equal(first.metrics.planStabilityRate, 1);
  assert.equal(first.metrics.explanationQualityRate, 1);
});

test("planner comparison reports before/after deltas without hiding regressions", () => {
  const before = benchmarkPlanner();
  const after = structuredClone(before);
  after.metrics.meanScheduleChurn = before.metrics.meanScheduleChurn - 1;
  const comparison = comparePlannerBenchmarks(before, after);
  assert.equal(comparison.delta.meanScheduleChurn, -1);
  assert.equal(comparison.delta.deadlineSuccessRate, 0);
});
