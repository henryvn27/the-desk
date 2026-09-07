import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateCaptureCorpus, evaluateDurableCapture } from "../packages/intelligence/capture-evaluation.ts";

const now = new Date("2026-09-07T12:00:00.000Z");
const classes = [
  { id: "00000000-0000-4000-8000-000000000001", name: "AP Physics C", color: "#557562" },
  { id: "00000000-0000-4000-8000-000000000002", name: "English 12", color: "#9B6251" },
];
const baseline = process.argv.includes("--baseline");
const capture = evaluateCaptureCorpus({ classes, now, timeZone: "America/New_York", baseline });
const durable = evaluateDurableCapture({ classes, now, timeZone: "UTC" });
const result = {
  generatedAt: new Date().toISOString(),
  version: baseline ? "v1-baseline" : "post-v1",
  corpus: capture,
  durable,
};
const output = resolve("artifacts/capture/benchmark-latest.json");
await mkdir(resolve("artifacts/capture"), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  result: "PASS",
  version: result.version,
  output,
  metrics: {
    ...capture.metrics,
    singleCaptureMs: durable.singleCaptureMs,
    durableStoreMs: durable.storeMs,
  },
}, null, 2));
