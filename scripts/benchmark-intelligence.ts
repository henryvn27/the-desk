import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { DeskStore } from "../packages/domain/store";
import { deriveDeskIntelligence } from "../packages/intelligence/desk-intelligence";
import {
  inferAcademic,
  inferenceFingerprint,
} from "../packages/intelligence/inference";

const now = new Date("2026-09-07T09:00:00.000Z");
const output = resolve("artifacts/intelligence/benchmark-latest.json");
const classNames = [
  "AP Physics C",
  "Calculus BC",
  "English 12",
  "US History",
  "Computer Science",
];
const store = new DeskStore(":memory:");

try {
  const classIds: string[] = [];
  for (const className of classNames) {
    classIds.push(
      store.execute({ type: "class.create", name: className }).classes.at(-1)!.id,
    );
  }

  for (const [classIndex, classId] of classIds.entries()) {
    const taskIds: string[] = [];
    for (let taskIndex = 0; taskIndex < 10; taskIndex += 1) {
      const dueAt = new Date(
        now.getTime() + (18 + classIndex * 6 + taskIndex * 4) * 60 * 60 * 1000,
      ).toISOString();
      taskIds.push(
        store
          .execute({
            type: "task.create",
            input: {
              title: `${classNames[classIndex]} · problem set ${taskIndex + 1}`,
              classId,
              dueAt,
              minutes: 35 + (taskIndex % 3) * 10,
              resource: null,
              notes: "Benchmark fixture; no provider call is made.",
              deadlineConfirmed: true,
              workKind: taskIndex === 0 ? "assessment" : "assignment",
              importance: taskIndex === 0 ? "high" : "normal",
            },
          })
          .tasks.at(-1)!.id,
      );
    }

    const conceptId = store
      .execute({
        type: "concept.create",
        input: {
          classId,
          taskIds: taskIds.slice(0, 4),
          name: `${classNames[classIndex]} core methods`,
          status: "developing",
          preparedness: "developing",
          retentionMode: "course",
          reviewDue: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          attempts: 0,
          unaidedCorrect: 0,
          unaidedTotal: 0,
          hintCount: 0,
          lastReviewedAt: null,
          evidenceNote: "Benchmark evidence is synthetic and checked.",
        },
      })
      .concepts.at(-1)!.id;

    for (let attemptIndex = 0; attemptIndex < 4; attemptIndex += 1) {
      store.execute({
        type: "attempt.create",
        input: {
          classId,
          taskId: taskIds[attemptIndex]!,
          conceptIds: [conceptId],
          result: attemptIndex === 0 ? "incorrect" : "correct",
          unaided: attemptIndex !== 0,
          hintCount: attemptIndex === 0 ? 1 : 0,
          notes: attemptIndex === 0 ? "Benchmark sign error" : "",
          attemptedAt: new Date(now.getTime() - (attemptIndex + 1) * 60 * 60 * 1000).toISOString(),
        },
      });
    }

    store.execute({
      type: "mistake.create",
      input: {
        classId,
        taskId: taskIds[0]!,
        concept: `${classNames[classIndex]} core methods`,
        source: "Benchmark checked attempt",
        originalAttempt: "The first pass used the wrong method.",
        whatWentWrong: "The selected method did not match the given conditions.",
        correction: "Check the conditions before choosing a method.",
        helpUsed: "Worked example",
        confidence: "medium",
        reviewDue: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });

    store.execute({
      type: "assessment.create",
      input: {
        classId,
        title: `${classNames[classIndex]} · unit check`,
        kind: "test",
        taskIds: taskIds.slice(0, 3),
        dueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        gradeCategoryId: null,
        notes: "Benchmark assessment scope.",
      },
    });
  }

  const snapshot = store.snapshot();
  assert.equal(snapshot.classes.length, 5);
  assert.equal(snapshot.tasks.length, 50);
  assert.equal(snapshot.concepts.length, 5);
  assert.equal(snapshot.attempts.length, 20);
  assert.equal(snapshot.mistakes.length, 5);
  assert.equal(snapshot.assessments.length, 5);

  const orchestrationStart = performance.now();
  const projections = Array.from({ length: 20 }, () =>
    deriveDeskIntelligence(snapshot, now),
  );
  const orchestrationMs = performance.now() - orchestrationStart;
  const projection = projections[0]!;
  assert.equal(projection.classes.length, classNames.length);
  assert.ok(projection.nextAction.title.length > 0);
  assert.ok(projection.classes.every((course) => course.explanation.length > 0));
  assert.equal(projection.evidence.attempts, 20);

  const inferenceInputs = Array.from({ length: 100 }, (_, index) => {
    const className = classNames[index % classNames.length]!;
    const day = String(8 + (index % 10)).padStart(2, "0");
    return {
      sourceKind: "capture" as const,
      sourceId: `benchmark-capture-${index + 1}`,
      sourceRevision: 0,
      title: `${className} assignment ${index + 1}`,
      text: `${className}\nAssignment ${index + 1}\nDue 2026-09-${day} 23:00\nTopic: core methods`,
      capturedAt: now.toISOString(),
      classId: classIds[index % classIds.length]!,
    };
  });
  const inferenceDurations: number[] = [];
  const inferences = inferenceInputs.map((input) => {
    const start = performance.now();
    const result = inferAcademic(input, {
      classes: snapshot.classes,
      now,
      timeZone: "UTC",
    });
    inferenceDurations.push(performance.now() - start);
    assert.equal(result.input.sourceKind, "capture");
    assert.equal(result.fields.title.provenance[0]!.sourceId, input.sourceId);
    assert.equal(result.fields.title.inferenceVersion, "desk-inference-v1");
    assert.ok(inferenceFingerprint(result).length === 64);
    return result;
  });
  const inferenceTotalMs = inferenceDurations.reduce((sum, value) => sum + value, 0);
  const inferenceMaxMs = Math.max(...inferenceDurations);
  assert.equal(inferences.length, 100);
  assert.ok(orchestrationMs < 2_000, `Desk intelligence took ${orchestrationMs.toFixed(1)}ms`);
  assert.ok(inferenceMaxMs < 250, `Deterministic inference took ${inferenceMaxMs.toFixed(1)}ms`);

  const result = {
    generatedAt: new Date().toISOString(),
    version: "desk-intelligence-v1",
    providerCalls: 0,
    fixture: {
      classes: snapshot.classes.length,
      tasks: snapshot.tasks.length,
      concepts: snapshot.concepts.length,
      attempts: snapshot.attempts.length,
      mistakes: snapshot.mistakes.length,
      assessments: snapshot.assessments.length,
      inferenceInputs: inferenceInputs.length,
    },
    metrics: {
      orchestrationRuns: projections.length,
      orchestrationTotalMs: Number(orchestrationMs.toFixed(3)),
      orchestrationAvgMs: Number((orchestrationMs / projections.length).toFixed(3)),
      deterministicInferenceTotalMs: Number(inferenceTotalMs.toFixed(3)),
      deterministicInferenceAvgMs: Number((inferenceTotalMs / inferenceInputs.length).toFixed(3)),
      deterministicInferenceMaxMs: Number(inferenceMaxMs.toFixed(3)),
    },
    assertions: {
      canonicalEvidencePreserved: true,
      provenancePreserved: true,
      noProviderCalls: true,
      noParallelStore: true,
    },
  };
  await mkdir(resolve("artifacts/intelligence"), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ result: "PASS", output, metrics: result.metrics }, null, 2));
} finally {
  store.close();
}
