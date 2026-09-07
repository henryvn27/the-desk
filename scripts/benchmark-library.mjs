import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DeskStore } from "../packages/domain/store.ts";
import { sourceSearch, sourceSections } from "../packages/sources/reader.ts";

const text = Array.from({ length: 1_800 }, (_, index) =>
  index % 50 === 0
    ? `# Chapter ${index / 50 + 1}`
    : `The acceleration example ${index} explains velocity, units, and evidence for the semester reading set.`,
).join("\n");
const timings = {};
let started = performance.now();
const sections = sourceSections(text);
timings.sectionsMs = performance.now() - started;
started = performance.now();
const matches = sourceSearch(text, "acceleration");
timings.searchMs = performance.now() - started;

const directory = mkdtempSync(join(tmpdir(), "desk-library-benchmark-"));
const store = new DeskStore(join(directory, "desk.sqlite"));
try {
  let snapshot = store.execute({ type: "class.create", name: "Benchmark" });
  const classId = snapshot.classes[0].id;
  snapshot = store.execute({
    type: "task.create",
    input: {
      title: "Long reading",
      classId,
      dueAt: null,
      minutes: 45,
      resource: null,
      notes: "",
      deadlineConfirmed: true,
    },
  });
  const taskId = snapshot.tasks[0].id;
  snapshot = store.execute({
    type: "source.create",
    input: { title: "Semester textbook", text, classIds: [classId], taskIds: [taskId], format: "pdf", sourceUrl: null },
  });
  const sourceId = snapshot.sources[0].id;
  started = performance.now();
  for (let index = 0; index < 500; index++) {
    store.execute({
      type: "source.annotate",
      sourceId,
      input: {
        sourceRevision: 0,
        text: `acceleration example ${index}`,
        comment: "benchmark annotation",
        location: { startOffset: index * 10, endOffset: index * 10 + 12 },
      },
    });
  }
  timings.annotationsMs = performance.now() - started;
  started = performance.now();
  const finalSnapshot = store.snapshot();
  timings.snapshotMs = performance.now() - started;
  started = performance.now();
  const indexed = store.search("benchmark annotation");
  timings.indexedSearchMs = performance.now() - started;
  console.log(JSON.stringify({
    textCharacters: text.length,
    sections: sections.length,
    matches: matches.length,
    annotations: finalSnapshot.sources[0].annotations?.length ?? 0,
    indexedResults: indexed.length,
    timingsMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Number(value.toFixed(2))])),
  }, null, 2));
} finally {
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
