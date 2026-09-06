import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeSummary } from "./index";
import type { GradeEntry } from "../domain/contracts";
const categories = [
  { id: "tests", classId: "physics", name: "Tests", weight: 80, revision: 0 },
  { id: "work", classId: "physics", name: "Work", weight: 20, revision: 0 },
];
const entry = (
  id: string,
  categoryId: string,
  earned: number,
  possible: number,
): GradeEntry => ({
  id,
  categoryId,
  title: id,
  earned,
  possible,
  revision: 0,
  recordedAt: "2026-09-05T12:00:00Z",
  updatedAt: "2026-09-05T12:00:00Z",
  authority: "user-entered",
});
test("missing category scores produce a range without renormalizing known weights", () => {
  const result = gradeSummary(categories, [entry("test", "tests", 90, 100)]);
  assert.equal(result.lower, 72);
  assert.equal(result.upper, 92);
  assert.equal(result.scoredWeight, 80);
});
test("category averages use points and distinguish zero from missing scores", () => {
  const result = gradeSummary(categories, [
    entry("a", "tests", 10, 10),
    entry("b", "tests", 40, 90),
    entry("c", "work", 0, 10),
  ]);
  assert.equal(result.lower, 40);
  assert.equal(result.upper, 40);
  assert.equal(result.scoredWeight, 100);
  assert.equal(result.rows[0]!.percent, 50);
  assert.equal(result.rows[1]!.percent, 0);
});
test("unconfigured weights remain unknown", () => {
  const result = gradeSummary(categories.slice(0, 1), [
    entry("a", "tests", 90, 100),
  ]);
  assert.equal(result.configuredWeight, 80);
  assert.equal(result.upper, 92);
});
