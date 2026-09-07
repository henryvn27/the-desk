import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureEvaluationCorpus,
  evaluateCaptureCorpus,
} from "./capture-evaluation";

const classes = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "AP Physics C",
    color: "#123456",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "English 12",
    color: "#654321",
  },
];

test("capture corpus covers requested modalities and keeps originals recoverable", () => {
  assert.ok(captureEvaluationCorpus.length >= 14);
  const evaluation = evaluateCaptureCorpus({
    classes,
    now: new Date("2026-09-07T12:00:00Z"),
    timeZone: "America/New_York",
  });
  assert.equal(evaluation.metrics.originalTextRecovered, true);
  assert.equal(evaluation.metrics.duplicateDetected, true);
  assert.ok(evaluation.metrics.objectTypeAccuracy >= 0.9);
  assert.ok(evaluation.metrics.autoFilePrecision >= 0.9);
});
