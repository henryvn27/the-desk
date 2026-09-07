import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { DeskStore } from "../packages/domain/store.ts";
import { deriveClassExperience } from "../packages/domain/class-experience.ts";

const output = resolve("artifacts/class/benchmark-latest.json");
const directory = await mkdtemp(join(tmpdir(), "desk-class-benchmark-"));
const store = new DeskStore(join(directory, "desk.sqlite"));
const now = new Date("2026-09-07T09:00:00.000Z");

try {
  let snapshot = store.execute({ type: "class.create", name: "AP Physics C" });
  const classId = snapshot.classes[0].id;
  snapshot = store.execute({
    type: "period.create",
    input: { name: "Fall 2026", kind: "semester", startsOn: "2026-08-24", endsOn: "2026-12-18", notes: "", classIds: [classId] },
  });
  snapshot = store.execute({
    type: "space.create",
    input: { name: "School", kind: "school", notes: "", classIds: [classId] },
  });
  snapshot = store.execute({ type: "track.create", input: { classId, name: "Mechanics", notes: "" } });
  const trackId = snapshot.tracks[0].id;
  snapshot = store.execute({
    type: "task.create",
    input: { title: "Problem Set 4", classId, dueAt: "2026-09-08T22:00:00.000Z", minutes: 45, resource: null, notes: "", deadlineConfirmed: true },
  });
  const taskId = snapshot.tasks[0].id;
  snapshot = store.execute({
    type: "unit.create",
    input: { classId, trackId, name: "Forces", kind: "unit", sequence: 2, notes: "", taskIds: [taskId] },
  });
  snapshot = store.execute({
    type: "concept.create",
    input: { classId, taskIds: [taskId], name: "Friction", status: "developing", preparedness: "developing", retentionMode: "course", reviewDue: null, attempts: 0, unaidedCorrect: 0, unaidedTotal: 0, hintCount: 0, lastReviewedAt: null, evidenceNote: "", prerequisiteConceptIds: [] },
  });
  const conceptId = snapshot.concepts[0].id;
  snapshot = store.execute({
    type: "assessment.create",
    input: { classId, title: "Unit 2 Test", kind: "test", taskIds: [taskId], dueAt: "2026-09-10T22:00:00.000Z", gradeCategoryId: null, notes: "", },
  });
  const assessmentId = snapshot.assessments[0].id;
  snapshot = store.execute({
    type: "source.create",
    input: { title: "Teacher slides", text: "Friction and free-body diagrams", classIds: [classId], taskIds: [taskId], format: "slides", sourceUrl: null, kind: "class-material" },
  });
  snapshot = store.execute({
    type: "teacher.create",
    input: { name: "Dr. Rivera", email: "", notes: "Office hours Thursday", classIds: [classId] },
  });
  const teacherId = snapshot.teachers[0].id;
  snapshot = store.execute({
    type: "evidence.create",
    input: { classId, teacherId, assessmentId, taskId, title: "Test feedback", kind: "teacher-feedback", source: "manual", scoreEarned: null, scorePossible: null, teacherComments: "Use a free-body diagram.", rubric: "", observations: "", conceptIds: [conceptId], includeInTeacherModeling: true, capturedAt: "2026-09-06T12:00:00.000Z" },
  });
  snapshot = store.execute({
    type: "grade.category",
    input: { classId, name: "Tests", weight: 60 },
  });
  const categoryId = snapshot.gradeCategories[0].id;
  snapshot = store.execute({
    type: "grade.entry",
    input: { categoryId, title: "Unit 1 Test", earned: 42, possible: 50 },
  });
  const projection = deriveClassExperience(snapshot, classId, now);
  assert.ok(projection);
  assert.equal(projection.next?.title, "Problem Set 4");
  assert.equal(projection.units.current[0]?.name, "Forces");
  assert.equal(projection.assessments[0]?.sourceTitles[0], "Teacher slides");
  assert.equal(projection.learning[0]?.name, "Friction");
  assert.equal(projection.teachers[0]?.name, "Dr. Rivera");
  await mkdir(resolve("artifacts/class"), { recursive: true });
  await writeFile(output, `${JSON.stringify({
    className: projection.classRecord.name,
    context: { periods: projection.periods, spaces: projection.spaces },
    next: projection.next,
    progression: projection.units,
    assessments: projection.assessments,
    learning: projection.learning,
    teachers: projection.teachers,
    sources: projection.sources,
    grade: { lower: projection.grade.lower, upper: projection.grade.upper, scoredWeight: projection.grade.scoredWeight, unknownCategories: projection.grade.unknownCategories },
    attention: projection.attention,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ result: "PASS", output, className: projection.classRecord.name, next: projection.next?.title, units: projection.units, assessmentCount: projection.assessments.length, learning: projection.learning.map((item) => `${item.name}:${item.preparedness}`), teacherCount: projection.teachers.length, sourceCount: projection.sources.length, gradeRange: `${projection.grade.lower.toFixed(1)}–${projection.grade.upper.toFixed(1)}%` }, null, 2));
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
