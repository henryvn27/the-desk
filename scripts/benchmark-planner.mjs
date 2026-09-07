import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { benchmarkPlanner, comparePlannerBenchmarks } from "../packages/planner/evaluation.ts";

const output = resolve("artifacts/planner/benchmark-latest.json");
await mkdir(resolve("artifacts/planner"), { recursive: true });
const before = benchmarkPlanner(undefined, "v1");
const after = benchmarkPlanner(undefined, "adaptive");
const comparison = comparePlannerBenchmarks(before, after);
await writeFile(output, `${JSON.stringify(comparison, null, 2)}\n`);
console.log(JSON.stringify({ result: "PASS", output, before: before.metrics, after: after.metrics, delta: comparison.delta }, null, 2));
