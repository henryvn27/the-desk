import assert from "node:assert/strict";
import test from "node:test";
import { boxplot, calculatedRows, dataColumnAliases, histogram, linearRegression, summarize } from "./data";

test("notebook-scale data helpers calculate summary and regression values", () => {
  assert.deepEqual(summarize([1, 2, 3, 4]), {
    count: 4,
    mean: 2.5,
    median: 2.5,
    min: 1,
    max: 4,
    standardDeviation: Math.sqrt(1.25),
  });
  assert.deepEqual(linearRegression([{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]), {
    slope: 2,
    intercept: 1,
    rSquared: 1,
    count: 3,
  });
  assert.equal(histogram([0, 1, 2, 3], 2).reduce((sum, bin) => sum + bin.count, 0), 4);
  assert.deepEqual(boxplot([1, 2, 3, 4, 5]), { min: 1, q1: 2, median: 3, q3: 4, max: 5 });
});

test("calculated columns derive deterministic values without mutating source rows", () => {
  const table = {
    columns: ["mass (kg)", "acceleration"],
    rows: [[5, 3], [2, 4], [null, 8]],
    calculatedColumns: [{ id: "force", name: "Force", expression: "mass_kg * acceleration" }],
  };
  assert.deepEqual(dataColumnAliases(table.columns, table.calculatedColumns), ["mass_kg", "acceleration", "Force"]);
  assert.deepEqual(calculatedRows(table), [[5, 3, 15], [2, 4, 8], [null, 8, null]]);
  assert.deepEqual(table.rows, [[5, 3], [2, 4], [null, 8]]);
});
